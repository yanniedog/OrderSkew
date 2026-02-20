use crate::memory_tracker::MemoryEfficientTracker;
use crate::position::PositionWithHash;
use crate::progress::ProgressTracker;
use crate::storage::{EdgeRecord, PositionRecord, PositionStorage};
use crate::zobrist::ZobristHasher;
use rayon::prelude::*;
use shakmaty::{fen::Fen, CastlingMode, Chess, Move, Position};
use std::sync::Arc;

/// Tree generator for chess positions
pub struct TreeGenerator {
    hasher: Arc<ZobristHasher>,
    storage: Arc<PositionStorage>,
    progress: Arc<ProgressTracker>,
    max_depth: u32,
    visited: Arc<MemoryEfficientTracker>,
}

impl TreeGenerator {
    /// Create a new tree generator
    pub fn new(
        hasher: Arc<ZobristHasher>,
        storage: Arc<PositionStorage>,
        progress: Arc<ProgressTracker>,
        max_depth: u32,
    ) -> Self {
        // Estimate capacity: for depth d, expect roughly 20^d positions
        // Use a conservative estimate of 1M positions
        let capacity = 1_000_000;
        let cache_size = 10_000;
        
        Self {
            hasher,
            storage,
            progress,
            max_depth,
            visited: Arc::new(MemoryEfficientTracker::new(capacity, cache_size)),
        }
    }
    
    /// Generate the full move tree starting from the initial position
    pub fn generate(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let initial_pos = Chess::default();
        let initial = PositionWithHash::new(
            initial_pos,
            &self.hasher,
            0,
            String::new(),
            None,
        );
        
        // Store initial position
        self.store_position(&initial)?;
        
        // Start recursive exploration
        self.explore_position(initial)?;
        
        // Flush remaining buffers
        self.storage.flush_all()?;
        
        Ok(())
    }
    
    /// Extend the tree by adding more depth
    /// This will explore all positions at the current max depth
    pub fn extend_tree(&self, additional_depth: u32) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let db = self.storage.db();
        let current_max = db.get_max_depth()?;
        let new_max = current_max + additional_depth;
        
        println!("Extending tree from depth {} to {}", current_max, new_max);
        
        // Get all positions at the current max depth
        let positions_at_max = db.get_positions_at_depth(current_max)?;
        
        println!("Found {} positions at depth {}", positions_at_max.len(), current_max);
        
        // Create a new generator with the extended max depth
        let extended_generator = TreeGenerator {
            hasher: self.hasher.clone(),
            storage: self.storage.clone(),
            progress: self.progress.clone(),
            max_depth: new_max,
            visited: self.visited.clone(),
        };
        
        // Explore each position at max depth
        for (hash, fen) in positions_at_max {
            // Reconstruct position from FEN
            let fen_position = Fen::from_ascii(fen.as_bytes())?;
            let pos: Chess = fen_position.into_position(CastlingMode::Standard)?;
            let pos_with_hash = PositionWithHash::new(
                pos,
                &self.hasher,
                current_max,
                String::new(), // Move sequence not needed for extension
                None,
            );
            
            // Only explore if this position's hash matches (sanity check)
            if pos_with_hash.hash == hash {
                extended_generator.explore_position(pos_with_hash)?;
            }
        }
        
        // Flush remaining buffers
        self.storage.flush_all()?;
        
        Ok(())
    }
    
    /// Resume generation from existing database
    /// This will continue exploring from positions that haven't been fully explored
    pub fn resume(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let db = self.storage.db();
        let current_max = db.get_max_depth()?;
        
        if current_max >= self.max_depth {
            println!("Tree already at or beyond target depth {}", self.max_depth);
            return Ok(());
        }
        
        println!("Resuming generation from depth {} to {}", current_max, self.max_depth);
        
        // Extend from current max to target max
        self.extend_tree(self.max_depth - current_max)
    }
    
    /// Get the shared memory tracker
    pub fn memory_tracker(&self) -> Arc<MemoryEfficientTracker> {
        self.visited.clone()
    }
    
    /// Explore a position and all its children
    fn explore_position(&self, pos: PositionWithHash) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Check depth limit
        if pos.depth >= self.max_depth {
            return Ok(());
        }
        
        // Generate all legal moves
        let legal_moves: Vec<Move> = pos.position.legal_moves().into_iter().collect();
        self.progress.set_frontier_size(legal_moves.len() as u64);
        self.progress.set_depth_completed(pos.depth as u64);
        
        if legal_moves.is_empty() {
            return Ok(());
        }
        
        // Clone Arc references for parallel execution
        let hasher = self.hasher.clone();
        let storage = self.storage.clone();
        let progress = self.progress.clone();
        let visited = self.visited.clone();
        let max_depth = self.max_depth;
        
        // Process moves in parallel using Rayon
        let results: Result<Vec<()>, Box<dyn std::error::Error + Send + Sync>> = legal_moves
            .par_iter()
            .enumerate()
            .map(|(move_index, chess_move)| {
                // Make the move - clone position first since we're in parallel
                // play returns Result, so we need to handle it
                let new_pos = match pos.position.clone().play(chess_move) {
                    Ok(p) => p,
                    Err(_) => return Ok(()), // Skip invalid moves (shouldn't happen with legal_moves)
                };
                
                // Create move sequence string
                let move_uci = format!("{}", chess_move);
                let mut new_move_sequence = pos.move_sequence.clone();
                if !new_move_sequence.is_empty() {
                    new_move_sequence.push(' ');
                }
                new_move_sequence.push_str(&move_uci);
                
                // Create position with hash
                let child = PositionWithHash::new(
                    new_pos,
                    &hasher,
                    pos.depth + 1,
                    new_move_sequence,
                    Some(pos.hash),
                );
                
                // Check if we've seen this position before.
                // First check the memory-efficient tracker
                let seen_in_memory = visited.contains(child.hash);
                
                // Also check database/buffer
                let exists_in_storage = storage.position_exists(child.hash)?;
                
                let edge = EdgeRecord {
                    parent_hash: pos.hash,
                    child_hash: child.hash,
                    move_uci,
                    move_index: move_index as u32,
                };
                storage.add_edge_always(edge)?;
                progress.increment_edges();

                if seen_in_memory || exists_in_storage {
                    // If bloom filter said yes but database said no, it's a false positive
                    if seen_in_memory && !exists_in_storage {
                        visited.record_false_positive();
                    }
                    
                    // Mark as confirmed in database cache if found
                    if exists_in_storage {
                        visited.confirm_in_db(child.hash);
                    }
                    
                    progress.increment_duplicates();
                    return Ok(());
                }
                
                // New position - mark it as seen
                visited.insert(child.hash);
                
                // Store the position
                let record = PositionRecord {
                    hash: child.hash,
                    fen: child.fen(),
                    depth: child.depth,
                    parent_hash: child.parent_hash,
                    move_sequence: child.move_sequence.clone(),
                    evaluation_score: None,
                    best_move: None,
                    game_result: None,
                };
                storage.add_position(record)?;
                
                // Update progress
                progress.increment_expanded();
                progress.increment_inserted();
                
                // Recursively explore (need to create a new generator for recursion)
                // For now, we'll do sequential recursion after parallel expansion
                // This is a trade-off: parallel at each level, but sequential depth-first
                let child_gen = TreeGenerator {
                    hasher: hasher.clone(),
                    storage: storage.clone(),
                    progress: progress.clone(),
                    max_depth,
                    visited: visited.clone(),
                };
                child_gen.explore_position(child)
            })
            .collect();
        
        results?;
        
        Ok(())
    }
    
    /// Store a position in the database
    fn store_position(&self, pos: &PositionWithHash) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let record = PositionRecord {
            hash: pos.hash,
            fen: pos.fen(),
            depth: pos.depth,
            parent_hash: pos.parent_hash,
            move_sequence: pos.move_sequence.clone(),
            evaluation_score: None,
            best_move: None,
            game_result: None,
        };
        
        self.storage.add_position(record)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbPool;
    use crate::storage::{EdgeRecord, PositionRecord};
    use shakmaty::{uci::Uci, Chess};
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
    fn deduplicates_positions_while_preserving_edges() {
        let db_path = temp_db_path("chess_graph_dedup");
        let db = Arc::new(DbPool::new(db_path.to_str().unwrap()).expect("db"));
        db.init_schema().expect("schema");

        let hasher = Arc::new(ZobristHasher::new());
        let storage = Arc::new(PositionStorage::new(db.clone(), 128));
        let play = |pos: &Chess, uci: &str| -> Chess {
            let uci_move = Uci::from_ascii(uci.as_bytes()).expect("parse uci");
            let mv = uci_move.to_move(pos).expect("uci move");
            pos.clone().play(&mv).expect("legal play")
        };

        // Root
        let root = Chess::default();
        let root_hash = hasher.hash(&root);
        storage
            .add_position(PositionRecord {
                hash: root_hash,
                fen: PositionWithHash::new(root.clone(), &hasher, 0, String::new(), None).fen(),
                depth: 0,
                parent_hash: None,
                move_sequence: String::new(),
                evaluation_score: None,
                best_move: None,
                game_result: None,
            })
            .expect("root insert");

        // g1f3, g8f6, f3g1 then g8h6 and h6g8 gives two edges into root-compatible state.
        let p1 = play(&root, "g1f3");
        let p1_hash = hasher.hash(&p1);
        storage
            .add_position(PositionRecord {
                hash: p1_hash,
                fen: PositionWithHash::new(p1.clone(), &hasher, 1, "g1f3".to_string(), Some(root_hash)).fen(),
                depth: 1,
                parent_hash: Some(root_hash),
                move_sequence: "g1f3".to_string(),
                evaluation_score: None,
                best_move: None,
                game_result: None,
            })
            .expect("p1");
        storage
            .add_edge_always(EdgeRecord {
                parent_hash: root_hash,
                child_hash: p1_hash,
                move_uci: "g1f3".to_string(),
                move_index: 0,
            })
            .expect("edge root->p1");

        let p2 = play(&p1, "g8f6");
        let p2_hash = hasher.hash(&p2);
        storage
            .add_position(PositionRecord {
                hash: p2_hash,
                fen: PositionWithHash::new(p2.clone(), &hasher, 2, "g1f3 g8f6".to_string(), Some(p1_hash)).fen(),
                depth: 2,
                parent_hash: Some(p1_hash),
                move_sequence: "g1f3 g8f6".to_string(),
                evaluation_score: None,
                best_move: None,
                game_result: None,
            })
            .expect("p2");
        storage
            .add_edge_always(EdgeRecord {
                parent_hash: p1_hash,
                child_hash: p2_hash,
                move_uci: "g8f6".to_string(),
                move_index: 0,
            })
            .expect("edge p1->p2");

        let p3 = play(&p2, "f3g1");
        let p3_hash = hasher.hash(&p3);
        storage
            .add_position(PositionRecord {
                hash: p3_hash,
                fen: PositionWithHash::new(p3.clone(), &hasher, 3, "g1f3 g8f6 f3g1".to_string(), Some(p2_hash)).fen(),
                depth: 3,
                parent_hash: Some(p2_hash),
                move_sequence: "g1f3 g8f6 f3g1".to_string(),
                evaluation_score: None,
                best_move: None,
                game_result: None,
            })
            .expect("p3");
        storage
            .add_edge_always(EdgeRecord {
                parent_hash: p2_hash,
                child_hash: p3_hash,
                move_uci: "f3g1".to_string(),
                move_index: 0,
            })
            .expect("edge p2->p3");

        // Return to the root state by Ng8 (same board+turn+castle+ep key).
        let root_again = play(&p3, "f6g8");
        let root_again_hash = hasher.hash(&root_again);
        assert_eq!(root_hash, root_again_hash, "expected deterministic transposition hash");
        storage
            .add_position(PositionRecord {
                hash: root_again_hash,
                fen: PositionWithHash::new(root_again.clone(), &hasher, 4, "g1f3 g8f6 f3g1 f6g8".to_string(), Some(p3_hash)).fen(),
                depth: 4,
                parent_hash: Some(p3_hash),
                move_sequence: "g1f3 g8f6 f3g1 f6g8".to_string(),
                evaluation_score: None,
                best_move: None,
                game_result: None,
            })
            .expect("root duplicate insert ignored");
        storage
            .add_edge_always(EdgeRecord {
                parent_hash: p3_hash,
                child_hash: root_again_hash,
                move_uci: "f6g8".to_string(),
                move_index: 0,
            })
            .expect("edge p3->root");

        storage.flush_all().expect("flush");

        let conn = db.connection().expect("conn");
        let total_positions: i64 = conn
            .query_row("SELECT COUNT(*) FROM positions", [], |row| row.get(0))
            .expect("positions");
        let distinct_positions: i64 = conn
            .query_row("SELECT COUNT(DISTINCT hash) FROM positions", [], |row| row.get(0))
            .expect("distinct");
        assert_eq!(total_positions, distinct_positions);

        let root_hash_db: i64 = conn
            .query_row("SELECT hash FROM positions WHERE depth = 0 LIMIT 1", [], |row| row.get(0))
            .expect("root");
        let incoming_to_root: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM edges WHERE child_hash = ?1",
                [root_hash_db],
                |row| row.get(0),
            )
            .expect("incoming");
        assert!(incoming_to_root >= 1, "expected at least one transposition edge back to root");

        let dangling_edges: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM edges e
                 LEFT JOIN positions p1 ON p1.hash = e.parent_hash
                 LEFT JOIN positions p2 ON p2.hash = e.child_hash
                 WHERE p1.hash IS NULL OR p2.hash IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("dangling");
        assert_eq!(dangling_edges, 0, "edges must reference existing positions");

        let _ = std::fs::remove_file(db_path);
    }
}
