use shakmaty::{CastlingSide, Chess, Color, Piece, Position, Role, Square};

/// Zobrist hash keys for chess positions
pub struct ZobristHasher {
    /// Keys for pieces on squares: [square][piece]
    piece_keys: [[u64; 12]; 64],
    /// Key for side to move (White = 0, Black = 1)
    side_key: u64,
    /// Keys for castling rights: [color][kingside/queenside]
    castling_keys: [[u64; 2]; 2],
    /// Keys for en passant squares: [square] (only rank 3 and 6 are valid)
    en_passant_keys: [u64; 64],
}

impl ZobristHasher {
    /// Create a new Zobrist hasher with random keys
    pub fn new() -> Self {
        let mut rng = fastrand::Rng::new();
        
        let mut piece_keys = [[0u64; 12]; 64];
        for square in 0..64 {
            for piece in 0..12 {
                piece_keys[square][piece] = rng.u64(..);
            }
        }
        
        let side_key = rng.u64(..);
        
        let mut castling_keys = [[0u64; 2]; 2];
        for color in 0..2 {
            for side in 0..2 {
                castling_keys[color][side] = rng.u64(..);
            }
        }
        
        let mut en_passant_keys = [0u64; 64];
        for square in 0..64 {
            en_passant_keys[square] = rng.u64(..);
        }
        
        Self {
            piece_keys,
            side_key,
            castling_keys,
            en_passant_keys,
        }
    }
    
    /// Get the piece index for Zobrist hashing
    fn piece_index(piece: Piece) -> usize {
        let role_index = match piece.role {
            Role::Pawn => 0,
            Role::Knight => 1,
            Role::Bishop => 2,
            Role::Rook => 3,
            Role::Queen => 4,
            Role::King => 5,
        };
        let color_offset = if piece.color == Color::White { 0 } else { 6 };
        role_index + color_offset
    }
    
    /// Compute Zobrist hash for a position
    pub fn hash(&self, pos: &Chess) -> u64 {
        let mut hash = 0u64;
        
        // Hash pieces on board
        for square in Square::ALL {
            if let Some(piece) = pos.board().piece_at(square) {
                let piece_idx = Self::piece_index(piece);
                hash ^= self.piece_keys[square as usize][piece_idx];
            }
        }
        
        // Hash side to move
        if pos.turn() == Color::Black {
            hash ^= self.side_key;
        }
        
        // Hash castling rights
        let castling = pos.castles();
        if castling.has(Color::White, CastlingSide::QueenSide) {
            hash ^= self.castling_keys[0][0];
        }
        if castling.has(Color::White, CastlingSide::KingSide) {
            hash ^= self.castling_keys[0][1];
        }
        if castling.has(Color::Black, CastlingSide::QueenSide) {
            hash ^= self.castling_keys[1][0];
        }
        if castling.has(Color::Black, CastlingSide::KingSide) {
            hash ^= self.castling_keys[1][1];
        }
        
        // Hash en passant square
        if let Some(ep_square) = pos.maybe_ep_square() {
            hash ^= self.en_passant_keys[ep_square as usize];
        }
        
        hash
    }
    
    /// Update hash incrementally when making a move
    /// This is more efficient than recomputing from scratch
    pub fn update_hash(&self, hash: u64, from: Square, to: Square, piece: Piece, captured: Option<Piece>, old_ep: Option<Square>, new_ep: Option<Square>) -> u64 {
        let mut new_hash = hash;
        let piece_idx = Self::piece_index(piece);
        
        // Remove piece from source square
        new_hash ^= self.piece_keys[from as usize][piece_idx];
        
        // Add piece to destination square
        new_hash ^= self.piece_keys[to as usize][piece_idx];
        
        // Handle captured piece
        if let Some(captured_piece) = captured {
            let captured_idx = Self::piece_index(captured_piece);
            new_hash ^= self.piece_keys[to as usize][captured_idx];
        }
        
        // Handle en passant changes
        if let Some(ep) = old_ep {
            new_hash ^= self.en_passant_keys[ep as usize];
        }
        if let Some(ep) = new_ep {
            new_hash ^= self.en_passant_keys[ep as usize];
        }
        
        // Toggle side to move
        new_hash ^= self.side_key;
        
        new_hash
    }
}

impl Default for ZobristHasher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_hash_consistency() {
        let hasher = ZobristHasher::new();
        let pos = Chess::default();
        let hash1 = hasher.hash(&pos);
        let hash2 = hasher.hash(&pos);
        assert_eq!(hash1, hash2);
    }
    
    #[test]
    fn test_different_positions_different_hashes() {
        let hasher = ZobristHasher::new();
        let pos1 = Chess::default();
        let hash1 = hasher.hash(&pos1);
        
        // Make a move
        let moves: Vec<_> = pos1.legal_moves().into_iter().collect();
        if !moves.is_empty() {
            let pos2 = pos1.play(&moves[0]).unwrap();
            let hash2 = hasher.hash(&pos2);
            assert_ne!(hash1, hash2);
        }
    }
}
