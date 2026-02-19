use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};

use shakmaty::{fen::Fen, CastlingMode, Chess, Color, Position};

/// Position evaluator using Stockfish chess engine
pub struct PositionEvaluator {
    /// Path to Stockfish executable
    stockfish_path: String,
    /// Stockfish process (if running)
    process: Arc<Mutex<Option<StockfishProcess>>>,
    /// Evaluation depth
    depth: u32,
}

struct StockfishProcess {
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

/// Position evaluation result
#[derive(Debug, Clone)]
pub struct Evaluation {
    /// Evaluation score in centipawns (positive = white advantage)
    pub score: i32,
    /// Best move in UCI format
    pub best_move: Option<String>,
    /// Game result (if terminal position)
    pub game_result: Option<GameResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameResult {
    WhiteWins,
    BlackWins,
    Draw,
}

impl PositionEvaluator {
    /// Create a new position evaluator
    /// stockfish_path: Path to Stockfish executable (e.g., "stockfish" or "/usr/bin/stockfish")
    /// depth: Search depth for evaluation
    pub fn new(stockfish_path: String, depth: u32) -> Self {
        Self {
            stockfish_path,
            process: Arc::new(Mutex::new(None)),
            depth,
        }
    }
    
    /// Start Stockfish process if not already running
    fn ensure_started(&self) -> Result<(), Box<dyn std::error::Error>> {
        let mut process_guard = self.process.lock().unwrap();
        if process_guard.is_some() {
            return Ok(());
        }
        
        let mut child = Command::new(&self.stockfish_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        
        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
        
        let mut stockfish = StockfishProcess {
            stdin,
            stdout: BufReader::new(stdout),
        };
        
        // Initialize Stockfish
        writeln!(stockfish.stdin, "uci")?;
        stockfish.stdin.flush()?;
        
        // Wait for "uciok"
        let mut line = String::new();
        loop {
            stockfish.stdout.read_line(&mut line)?;
            if line.contains("uciok") {
                break;
            }
            line.clear();
        }
        
        // Set options
        writeln!(stockfish.stdin, "setoption name MultiPV value 1")?;
        writeln!(stockfish.stdin, "setoption name Threads value 1")?;
        stockfish.stdin.flush()?;
        
        *process_guard = Some(stockfish);
        Ok(())
    }
    
    /// Evaluate a position from FEN string
    pub fn evaluate(&self, fen: &str) -> Result<Evaluation, Box<dyn std::error::Error>> {
        self.ensure_started()?;
        
        let mut process_guard = self.process.lock().unwrap();
        let stockfish = process_guard.as_mut().ok_or("Stockfish not started")?;
        
        // Set position
        writeln!(stockfish.stdin, "position fen {}", fen)?;
        writeln!(stockfish.stdin, "go depth {}", self.depth)?;
        stockfish.stdin.flush()?;
        
        // Read response
        let mut line = String::new();
        let mut score = 0;
        let mut best_move: Option<String> = None;
        
        loop {
            line.clear();
            stockfish.stdout.read_line(&mut line)?;
            
            if line.starts_with("bestmove") {
                // Parse best move: "bestmove e2e4"
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    best_move = Some(parts[1].to_string());
                }
                break;
            } else if line.starts_with("info") && line.contains("score") {
                // Parse score: "info depth 10 score cp 25" or "info depth 10 score mate 3"
                if line.contains("mate") {
                    // Checkmate in N moves
                    if let Some(mate_pos) = line.find("mate") {
                        let rest = &line[mate_pos + 4..];
                        if let Some(mate_moves) = rest
                            .split_whitespace()
                            .next()
                            .and_then(|s| s.parse::<i32>().ok())
                        {
                            score = if mate_moves > 0 { 10000 } else { -10000 };
                        }
                    }
                } else if line.contains("cp") {
                    // Centipawn evaluation
                    if let Some(cp_pos) = line.find("cp") {
                        let rest = &line[cp_pos + 2..];
                        if let Some(cp_score) = rest
                            .split_whitespace()
                            .next()
                            .and_then(|s| s.parse::<i32>().ok())
                        {
                            score = cp_score;
                        }
                    }
                }
            }
        }
        
        // Determine game result if terminal
        let game_result = self.determine_game_result(fen)?;
        
        Ok(Evaluation {
            score,
            best_move,
            game_result,
        })
    }
    
    /// Determine if position is terminal (checkmate/stalemate)
    fn determine_game_result(&self, fen: &str) -> Result<Option<GameResult>, Box<dyn std::error::Error>> {
        let fen_position = Fen::from_ascii(fen.as_bytes())?;
        let pos: Chess = fen_position.into_position(CastlingMode::Standard)?;
        
        // Check if it's checkmate
        if pos.is_checkmate() {
            return Ok(Some(if pos.turn() == Color::White {
                GameResult::BlackWins
            } else {
                GameResult::WhiteWins
            }));
        }
        
        // Check if it's stalemate or draw
        if pos.is_stalemate() || pos.is_insufficient_material() {
            return Ok(Some(GameResult::Draw));
        }
        
        // Check for threefold repetition (simplified - would need move history)
        // For now, just check if no legal moves
        let legal_moves = pos.legal_moves();
        if legal_moves.is_empty() {
            return Ok(Some(GameResult::Draw));
        }
        
        Ok(None)
    }
    
    /// Stop Stockfish process
    pub fn stop(&self) {
        let mut process_guard = self.process.lock().unwrap();
        if let Some(mut stockfish) = process_guard.take() {
            let _ = writeln!(stockfish.stdin, "quit");
            let _ = stockfish.stdin.flush();
        }
    }
}

impl Drop for PositionEvaluator {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_evaluator_creation() {
        // This test requires Stockfish to be installed
        // Skip if not available
        let evaluator = PositionEvaluator::new("stockfish".to_string(), 10);
        // Just test that it can be created
        assert_eq!(evaluator.depth, 10);
    }
}

