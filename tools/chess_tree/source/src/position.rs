use crate::zobrist::ZobristHasher;
use shakmaty::{fen::Fen, Chess, EnPassantMode};

/// Position wrapper with cached hash
pub struct PositionWithHash {
    pub position: Chess,
    pub hash: u64,
    pub depth: u32,
    pub move_sequence: String,
    pub parent_hash: Option<u64>,
}

impl PositionWithHash {
    /// Create a new position with hash from a Chess position
    pub fn new(
        position: Chess,
        hasher: &ZobristHasher,
        depth: u32,
        move_sequence: String,
        parent_hash: Option<u64>,
    ) -> Self {
        let hash = hasher.hash(&position);
        Self {
            position,
            hash,
            depth,
            move_sequence,
            parent_hash,
        }
    }
    
    /// Get the FEN representation
    pub fn fen(&self) -> String {
        Fen::from_position(self.position.clone(), EnPassantMode::Legal)
            .to_string()
    }
}

