use chess_move_tree::config::{Config, ConfigArgs};
use chess_move_tree::db::DbPool;
use chess_move_tree::generator::TreeGenerator;
use chess_move_tree::progress::ProgressTracker;
use chess_move_tree::server;
use chess_move_tree::storage::PositionStorage;
use chess_move_tree::zobrist::ZobristHasher;
use clap::Parser;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

#[derive(Parser)]
#[command(name = "chess-move-tree")]
#[command(about = "High-performance parallel chess move tree generator")]
struct Args {
    /// Maximum depth in full moves (default: 10)
    #[arg(short, long, default_value_t = 10)]
    depth: u32,
    
    /// Path to SQLite database file
    #[arg(long, default_value = "chess_tree.db")]
    db_path: String,
    
    /// Number of threads (0 = auto-detect)
    #[arg(short, long, default_value_t = 0)]
    threads: usize,
    
    /// Buffer size for batch inserts
    #[arg(short, long, default_value_t = 1000)]
    buffer_size: usize,
    
    /// Start visualization server after generation
    #[arg(short, long)]
    serve: bool,
    
    /// Port for visualization server
    #[arg(long, default_value_t = 8080)]
    port: u16,
    
    /// Only serve visualization (skip tree generation)
    #[arg(long)]
    serve_only: bool,
    
    /// Resume generation from existing database
    #[arg(long)]
    resume: bool,
    
    /// Extend tree by additional depth (plies)
    #[arg(long)]
    extend: Option<u32>,
    
    /// Path to configuration file
    #[arg(short = 'c', long)]
    config: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args = Args::parse();
    
    // Load configuration
    let mut config = if let Some(config_path) = &args.config {
        Config::load_or_default(config_path)
    } else {
        Config::default()
    };
    
    // Merge command-line arguments (they take precedence)
    let config_args = ConfigArgs {
        depth: Some(args.depth),
        threads: if args.threads > 0 { Some(args.threads) } else { config.generation.threads },
        buffer_size: Some(args.buffer_size),
        db_path: Some(args.db_path.clone()),
        port: Some(args.port),
        serve: args.serve,
    };
    config.merge_args(&config_args);
    
    // If serve_only, just start the server
    if args.serve_only {
        println!("Starting visualization server only...");
        server::start_server(config.storage.path, config.server.port).await?;
        return Ok(());
    }
    
    // Set up thread pool if specified
    if let Some(threads) = config.generation.threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global()
            .unwrap();
    }
    
    println!("=== Chess Move Tree Generator ===");
    println!("Depth: {} full moves ({} plies)", config.generation.max_depth, config.generation.max_depth * 2);
    println!("Database: {}", config.storage.path);
    println!("Threads: {}", config.generation.threads.unwrap_or_else(|| num_cpus::get()));
    println!();
    
    // Initialize database
    println!("Initializing database...");
    let db = Arc::new(DbPool::new(&config.storage.path)?);
    db.init_schema()?;
    println!("Database initialized.");
    
    // Create components
    let hasher = Arc::new(ZobristHasher::new());
    let storage = Arc::new(PositionStorage::new(db.clone(), config.generation.buffer_size));
    let mut progress = ProgressTracker::new();
    
    // Create generator (this creates the memory tracker)
    let generator = TreeGenerator::new(
        hasher,
        storage.clone(),
        Arc::new(progress.clone()),
        config.generation.max_depth * 2, // Convert full moves to plies
    );
    
    // Connect memory tracker to progress tracker
    progress.set_memory_tracker(generator.memory_tracker());
    let progress = Arc::new(progress);
    
    // Start progress reporting
    ProgressTracker::start_reporting_arc(progress.clone(), 2);
    
    // Set up signal handler for graceful shutdown
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    
    ctrlc::set_handler(move || {
        println!("\n\nShutdown requested...");
        running_clone.store(false, Ordering::Relaxed);
    })?;
    
    // Determine generation mode and capture extend value
    let extend_value = args.extend;
    let resume_flag = args.resume;
    
    // Run generation in a separate thread so we can check for shutdown
    let (tx, rx) = mpsc::channel();
    let _generator_thread = std::thread::spawn(move || {
        let result = if resume_flag {
            generator.resume()
        } else if let Some(additional) = extend_value {
            generator.extend_tree(additional)
        } else {
            generator.generate()
        };
        tx.send(result).unwrap();
    });
    
    // Wait for completion or shutdown signal
    loop {
        if !running.load(Ordering::Relaxed) {
            println!("\nShutting down...");
            break;
        }
        
        if let Ok(result) = rx.try_recv() {
            result?;
            break;
        }
        
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    
    // Stop progress reporting
    progress.stop();
    
    // Flush any remaining data
    storage.flush_all()?;
    
    // Print final statistics
    progress.print_final();
    
    println!("\nDone! Database saved to: {}", config.storage.path);
    
    // Start visualization server if requested
    if config.server.enabled {
        println!("\nStarting visualization server...");
        server::start_server(config.storage.path, config.server.port).await?;
    }
    
    Ok(())
}
