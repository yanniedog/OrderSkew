use crate::db::DbPool;
use crate::metrics::{MetricsCollector, MetricsSnapshot};
use lru::LruCache;
use rusqlite::Result as SqlResult;
use serde::{Deserialize, Serialize};
use std::num::NonZeroUsize;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

const POSITION_CACHE_SIZE: usize = 512;
const STATS_CACHE_TTL: Duration = Duration::from_millis(750);
const DEFAULT_PARENT_LIMIT: u32 = 24;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PositionNode {
    pub hash: u64,
    pub fen: String,
    pub depth: u32,
    pub parent_hash: Option<u64>,
    pub move_sequence: String,
    pub child_count: u32,
    pub children: Vec<MoveEdge>,
    pub parents: Vec<ParentEdge>,
    pub in_degree: u32,
    pub out_degree: u32,
    pub transposition: bool,
    pub evaluation_score: Option<i32>,
    pub best_move: Option<String>,
    pub game_result: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MoveEdge {
    pub move_uci: String,
    pub child_hash: u64,
    pub move_index: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParentEdge {
    pub parent_hash: u64,
    pub move_uci: String,
    pub move_index: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Neighbors {
    pub hash: u64,
    pub parents: Vec<ParentEdge>,
    pub children: Vec<MoveEdge>,
}

pub struct TreeApi {
    db: Arc<DbPool>,
    position_cache: RwLock<LruCache<u64, PositionNode>>,
    stats_cache: RwLock<Option<(TreeStats, Instant)>>,
    metrics: MetricsCollector,
}

impl TreeApi {
    pub fn new(db: Arc<DbPool>) -> Self {
        Self {
            db,
            position_cache: RwLock::new(LruCache::new(
                NonZeroUsize::new(POSITION_CACHE_SIZE).expect("cache size must be > 0"),
            )),
            stats_cache: RwLock::new(None),
            metrics: MetricsCollector::new(),
        }
    }

    /// Get a position node with its children
    pub fn get_position(&self, hash: Option<u64>) -> SqlResult<PositionNode> {
        if let Some(hash) = hash {
            if let Some(cached) = {
                let mut cache = self.position_cache.write().unwrap();
                cache.get(&hash).cloned()
            } {
                self.metrics.record_cache_hit();
                return Ok(cached);
            }
        }

        let conn = self.db.connection()?;
        self.metrics.record_cache_miss();
        let position_timer = Instant::now();

        // If no hash provided, get the root position (depth 0)
        let (hash, fen, depth, parent_hash, move_sequence, evaluation_score, best_move, game_result) = if let Some(h) = hash {
            let mut stmt = conn.prepare(
                "SELECT hash, fen, depth, parent_hash, move_sequence, evaluation_score, best_move, game_result FROM positions WHERE hash = ?1"
            )?;
            let row = stmt.query_row([h as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)? as u32,
                    row.get::<_, Option<i64>>(3)?.map(|h| h as u64),
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<i32>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })?;
            row
        } else {
            // Get root position
            let mut stmt = conn.prepare(
                "SELECT hash, fen, depth, parent_hash, move_sequence, evaluation_score, best_move, game_result FROM positions WHERE depth = 0 LIMIT 1"
            )?;
            let row = stmt.query_row([], |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, String>(1)?,
                    row.get::<_, i32>(2)? as u32,
                    row.get::<_, Option<i64>>(3)?.map(|h| h as u64),
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<i32>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })?;
            row
        };

        self.metrics
            .record_database_operation(position_timer.elapsed().as_millis() as u64);

        // Get graph relationships.
        let children_timer = Instant::now();
        let children = Self::query_children(&conn, hash)?;
        let parents = Self::query_parents(&conn, hash, DEFAULT_PARENT_LIMIT)?;
        let (in_degree, out_degree) = Self::query_degrees(&conn, hash)?;

        self.metrics
            .record_database_operation(children_timer.elapsed().as_millis() as u64);

        let node = PositionNode {
            hash,
            fen,
            depth,
            parent_hash,
            move_sequence,
            child_count: children.len() as u32,
            children,
            parents,
            in_degree,
            out_degree,
            transposition: in_degree > 1,
            evaluation_score,
            best_move,
            game_result,
        };

        self.position_cache
            .write()
            .unwrap()
            .put(node.hash, node.clone());

        Ok(node)
    }
    
    /// Get database reference (for server.rs)
    pub fn db(&self) -> Arc<DbPool> {
        self.db.clone()
    }

    /// Access live metrics snapshot
    pub fn metrics_snapshot(&self) -> MetricsSnapshot {
        self.metrics.get_metrics()
    }

    pub fn metrics(&self) -> &MetricsCollector {
        &self.metrics
    }

    /// Get parents + children for a node, useful for graph navigation.
    pub fn get_neighbors(&self, hash: u64, parent_limit: Option<u32>) -> SqlResult<Neighbors> {
        let conn = self.db.connection()?;
        let timer = Instant::now();
        let children = Self::query_children(&conn, hash)?;
        let parents = Self::query_parents(&conn, hash, parent_limit.unwrap_or(DEFAULT_PARENT_LIMIT))?;
        self.metrics
            .record_database_operation(timer.elapsed().as_millis() as u64);
        Ok(Neighbors { hash, parents, children })
    }

    /// Get statistics about the tree
    pub fn get_stats(&self) -> SqlResult<TreeStats> {
        if let Some((stats, timestamp)) = self.stats_cache.read().unwrap().as_ref() {
            if timestamp.elapsed() < STATS_CACHE_TTL {
                return Ok(stats.clone());
            }
        }

        let conn = self.db.connection()?;
        let stats_timer = Instant::now();

        let total_positions: i64 = conn.query_row(
            "SELECT COUNT(*) FROM positions",
            [],
            |row| row.get(0),
        )?;

        let total_edges: i64 = conn.query_row(
            "SELECT COUNT(*) FROM edges",
            [],
            |row| row.get(0),
        )?;

        let max_depth: i32 = conn.query_row(
            "SELECT MAX(depth) FROM positions",
            [],
            |row| row.get(0),
        )?;

        let positions_by_depth: Vec<(i32, i64)> = conn
            .prepare("SELECT depth, COUNT(*) FROM positions GROUP BY depth ORDER BY depth")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        let stats = TreeStats {
            total_positions: total_positions as u64,
            total_edges: total_edges as u64,
            max_depth: max_depth as u32,
            positions_by_depth: positions_by_depth
                .into_iter()
                .map(|(d, c)| (d as u32, c as u64))
                .collect(),
        };

        self.metrics
            .record_database_operation(stats_timer.elapsed().as_millis() as u64);

        self.stats_cache
            .write()
            .unwrap()
            .replace((stats.clone(), Instant::now()));

        Ok(stats)
    }
}

impl TreeApi {
    fn query_children(conn: &rusqlite::Connection, hash: u64) -> SqlResult<Vec<MoveEdge>> {
        let mut stmt = conn.prepare(
            "SELECT move_uci, child_hash, move_index FROM edges WHERE parent_hash = ?1 ORDER BY move_index"
        )?;
        let mapped = stmt.query_map([hash as i64], |row| {
            Ok(MoveEdge {
                move_uci: row.get(0)?,
                child_hash: row.get::<_, i64>(1)? as u64,
                move_index: row.get::<_, i32>(2)? as u32,
            })
        })?;
        mapped.collect::<Result<Vec<_>, _>>()
    }

    fn query_parents(conn: &rusqlite::Connection, hash: u64, limit: u32) -> SqlResult<Vec<ParentEdge>> {
        let mut stmt = conn.prepare(
            "SELECT parent_hash, move_uci, move_index
             FROM edges
             WHERE child_hash = ?1
             ORDER BY move_index, parent_hash
             LIMIT ?2"
        )?;
        let mapped = stmt.query_map([hash as i64, limit as i64], |row| {
            Ok(ParentEdge {
                parent_hash: row.get::<_, i64>(0)? as u64,
                move_uci: row.get(1)?,
                move_index: row.get::<_, i32>(2)? as u32,
            })
        })?;
        mapped.collect::<Result<Vec<_>, _>>()
    }

    fn query_degrees(conn: &rusqlite::Connection, hash: u64) -> SqlResult<(u32, u32)> {
        let in_degree = conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE child_hash = ?1",
            [hash as i64],
            |row| row.get::<_, i64>(0),
        )? as u32;
        let out_degree = conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE parent_hash = ?1",
            [hash as i64],
            |row| row.get::<_, i64>(0),
        )? as u32;
        Ok((in_degree, out_degree))
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TreeStats {
    pub total_positions: u64,
    pub total_edges: u64,
    pub max_depth: u32,
    pub positions_by_depth: Vec<(u32, u64)>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbPool;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("{}_{}.db", prefix, stamp))
    }

    #[test]
    fn position_includes_graph_degrees_and_parents() {
        let db_path = temp_db_path("api_graph_shape");
        let db = Arc::new(DbPool::new(db_path.to_str().unwrap()).expect("db"));
        db.init_schema().expect("schema");
        let conn = db.connection().expect("conn");

        conn.execute(
            "INSERT INTO positions (hash, fen, depth, parent_hash, move_sequence) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![1i64, "start", 0i32, Option::<i64>::None, ""],
        )
        .expect("root");
        conn.execute(
            "INSERT INTO positions (hash, fen, depth, parent_hash, move_sequence) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![2i64, "p2", 1i32, Some(1i64), "e2e4"],
        )
        .expect("p2");
        conn.execute(
            "INSERT INTO positions (hash, fen, depth, parent_hash, move_sequence) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![3i64, "p3", 1i32, Some(1i64), "d2d4"],
        )
        .expect("p3");
        conn.execute(
            "INSERT INTO edges (parent_hash, child_hash, move_uci, move_index) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![1i64, 2i64, "e2e4", 0i32],
        )
        .expect("edge12");
        conn.execute(
            "INSERT INTO edges (parent_hash, child_hash, move_uci, move_index) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![3i64, 2i64, "d4e5", 0i32],
        )
        .expect("edge32");

        let api = TreeApi::new(db.clone());
        let node = api.get_position(Some(2)).expect("node");
        assert_eq!(node.in_degree, 2);
        assert_eq!(node.out_degree, 0);
        assert!(node.transposition);
        assert_eq!(node.parents.len(), 2);

        let neighbors = api.get_neighbors(2, Some(10)).expect("neighbors");
        assert_eq!(neighbors.parents.len(), 2);
        assert_eq!(neighbors.children.len(), 0);

        let _ = std::fs::remove_file(db_path);
    }
}
