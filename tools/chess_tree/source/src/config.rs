use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub generation: GenerationConfig,
    pub storage: StorageConfig,
    pub evaluation: Option<EvaluationConfig>,
    pub server: ServerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationConfig {
    pub max_depth: u32,
    pub threads: Option<usize>,
    pub buffer_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub backend: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationConfig {
    pub stockfish_path: Option<String>,
    pub depth: u32,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub enabled: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            generation: GenerationConfig {
                max_depth: 10,
                threads: None,
                buffer_size: 1000,
            },
            storage: StorageConfig {
                backend: "sqlite".to_string(),
                path: "chess_tree.db".to_string(),
            },
            evaluation: Some(EvaluationConfig {
                stockfish_path: None,
                depth: 10,
                enabled: false,
            }),
            server: ServerConfig {
                port: 8080,
                enabled: false,
            },
        }
    }
}

impl Config {
    /// Load configuration from a TOML file
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error>> {
        let content = fs::read_to_string(path)?;
        let config: Config = toml::from_str(&content)?;
        Ok(config)
    }
    
    /// Load configuration from file or use defaults
    pub fn load_or_default<P: AsRef<Path>>(path: P) -> Self {
        Self::from_file(path).unwrap_or_else(|_| {
            println!("Warning: Could not load config file, using defaults");
            Self::default()
        })
    }
    
    /// Save configuration to a TOML file
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<(), Box<dyn std::error::Error>> {
        let content = toml::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }
    
    /// Merge with command-line arguments (command-line takes precedence)
    pub fn merge_args(&mut self, args: &ConfigArgs) {
        if let Some(depth) = args.depth {
            self.generation.max_depth = depth;
        }
        if let Some(threads) = args.threads {
            self.generation.threads = Some(threads);
        }
        if let Some(buffer_size) = args.buffer_size {
            self.generation.buffer_size = buffer_size;
        }
        if let Some(db_path) = &args.db_path {
            self.storage.path = db_path.clone();
        }
        if let Some(port) = args.port {
            self.server.port = port;
        }
        if args.serve {
            self.server.enabled = true;
        }
    }
}

/// Command-line arguments that can override config
pub struct ConfigArgs {
    pub depth: Option<u32>,
    pub threads: Option<usize>,
    pub buffer_size: Option<usize>,
    pub db_path: Option<String>,
    pub port: Option<u16>,
    pub serve: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.generation.max_depth, 10);
        assert_eq!(config.storage.backend, "sqlite");
    }
    
    #[test]
    fn test_config_serialization() {
        let config = Config::default();
        let toml_str = toml::to_string(&config).unwrap();
        let _: Config = toml::from_str(&toml_str).unwrap();
    }
}


