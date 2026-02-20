use crate::db::DbPool;
use rusqlite::{params, Result as SqlResult};
use std::sync::{Arc, Mutex};

/// Batch storage for positions and edges
pub struct PositionStorage {
    db: Arc<DbPool>,
    position_buffer: Arc<Mutex<Vec<PositionRecord>>>,
    edge_buffer: Arc<Mutex<Vec<EdgeRecord>>>,
    buffer_size: usize,
}

#[derive(Clone)]
pub struct PositionRecord {
    pub hash: u64,
    pub fen: String,
    pub depth: u32,
    pub parent_hash: Option<u64>,
    pub move_sequence: String,
    pub evaluation_score: Option<i32>,
    pub best_move: Option<String>,
    pub game_result: Option<String>,
}

#[derive(Clone)]
pub struct EdgeRecord {
    pub parent_hash: u64,
    pub child_hash: u64,
    pub move_uci: String,
    pub move_index: u32,
}

impl PositionStorage {
    /// Create a new position storage with batching
    pub fn new(db: Arc<DbPool>, buffer_size: usize) -> Self {
        Self {
            db,
            position_buffer: Arc::new(Mutex::new(Vec::with_capacity(buffer_size))),
            edge_buffer: Arc::new(Mutex::new(Vec::with_capacity(buffer_size * 20))), // Assume avg 20 moves per position
            buffer_size,
        }
    }
    
    /// Add a position to the buffer (will flush if buffer is full)
    pub fn add_position(&self, record: PositionRecord) -> SqlResult<()> {
        let mut buffer = self.position_buffer.lock().unwrap();
        buffer.push(record);
        
        if buffer.len() >= self.buffer_size {
            self.flush_positions()?;
        }
        
        Ok(())
    }
    
    /// Add an edge to the buffer. Edges are stored even when the child position
    /// already exists so transpositions are preserved in the graph.
    pub fn add_edge(&self, record: EdgeRecord) -> SqlResult<()> {
        let mut buffer = self.edge_buffer.lock().unwrap();
        buffer.push(record);
        
        if buffer.len() >= self.buffer_size {
            self.flush_edges()?;
        }
        
        Ok(())
    }

    /// Compatibility alias for graph-first callers.
    pub fn add_edge_always(&self, record: EdgeRecord) -> SqlResult<()> {
        self.add_edge(record)
    }
    
    /// Flush all buffered positions to database
    pub fn flush_positions(&self) -> SqlResult<usize> {
        let mut buffer_guard = self.position_buffer.lock().unwrap();
        if buffer_guard.is_empty() {
            return Ok(0);
        }
        let records: Vec<PositionRecord> = buffer_guard.drain(..).collect();
        drop(buffer_guard);

        let mut conn = self.db.connection()?;
        let transaction = conn.transaction()?;
        
        let count = {
            let mut stmt = transaction.prepare(
                "INSERT OR IGNORE INTO positions (hash, fen, depth, parent_hash, move_sequence, evaluation_score, best_move, game_result) 
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
            )?;
            
            let mut inserted = 0usize;
            for record in &records {
                inserted += stmt.execute(params![
                    record.hash as i64,
                    record.fen,
                    record.depth as i32,
                    record.parent_hash.map(|h| h as i64),
                    record.move_sequence,
                    record.evaluation_score.map(|s| s as i32),
                    record.best_move.as_ref(),
                    record.game_result.as_ref(),
                ])?;
            }
            inserted
        };
        
        transaction.commit()?;
        Ok(count)
    }
    
    /// Flush all buffered edges to database
    pub fn flush_edges(&self) -> SqlResult<usize> {
        let mut buffer_guard = self.edge_buffer.lock().unwrap();
        if buffer_guard.is_empty() {
            return Ok(0);
        }
        let records: Vec<EdgeRecord> = buffer_guard.drain(..).collect();
        drop(buffer_guard);

        let mut conn = self.db.connection()?;
        let transaction = conn.transaction()?;
        
        let count = {
            let mut stmt = transaction.prepare(
                "INSERT OR IGNORE INTO edges (parent_hash, child_hash, move_uci, move_index) 
                 VALUES (?1, ?2, ?3, ?4)"
            )?;
            
            let mut inserted = 0usize;
            for record in &records {
                inserted += stmt.execute(params![
                    record.parent_hash as i64,
                    record.child_hash as i64,
                    record.move_uci,
                    record.move_index as i32,
                ])?;
            }
            inserted
        };
        
        transaction.commit()?;
        Ok(count)
    }
    
    /// Flush all buffers
    pub fn flush_all(&self) -> SqlResult<(usize, usize)> {
        let positions = self.flush_positions()?;
        let edges = self.flush_edges()?;
        Ok((positions, edges))
    }
    
    /// Check if a position exists (checks both buffer and database)
    pub fn position_exists(&self, hash: u64) -> SqlResult<bool> {
        // Check buffer first
        let buffer = self.position_buffer.lock().unwrap();
        if buffer.iter().any(|r| r.hash == hash) {
            return Ok(true);
        }
        drop(buffer);
        
        // Check database
        self.db.position_exists(hash)
    }
    
    /// Update position with evaluation data
    pub fn update_evaluation(&self, hash: u64, evaluation_score: Option<i32>, best_move: Option<String>, game_result: Option<String>) -> SqlResult<()> {
        let conn = self.db.connection()?;
        
        conn.execute(
            "UPDATE positions SET evaluation_score = ?1, best_move = ?2, game_result = ?3 WHERE hash = ?4",
            params![
                evaluation_score.map(|s| s as i32),
                best_move.as_ref(),
                game_result.as_ref(),
                hash as i64,
            ],
        )?;
        
        Ok(())
    }
    
    /// Get database reference
    pub fn db(&self) -> Arc<DbPool> {
        self.db.clone()
    }


}
