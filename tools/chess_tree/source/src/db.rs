use anyhow::Context;
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::ffi::{Error as FfiError, ErrorCode};
use rusqlite::{params, Connection, Error as SqlError, OpenFlags, Result as SqlResult};
use std::sync::Arc;
use std::time::Duration;

/// Thread-safe database connection pool wrapper
#[derive(Clone)]
pub struct DbPool {
    pool: Arc<Pool<SqliteConnectionManager>>,
}

impl DbPool {
    /// Create a new database connection pool
    pub fn new(db_path: &str) -> anyhow::Result<Self> {
        let flags = OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_FULL_MUTEX;

        let manager = SqliteConnectionManager::file(db_path)
            .with_flags(flags)
            .with_init(|conn| {
                configure_connection(conn)?;
                Ok(())
            });

        let pool = Pool::builder()
            .max_size(16)
            .min_idle(Some(4))
            .connection_timeout(Duration::from_secs(5))
            .build(manager)
            .context("Failed to create SQLite connection pool")?;

        Ok(Self {
            pool: Arc::new(pool),
        })
    }

    fn map_pool_error(err: r2d2::Error) -> SqlError {
        SqlError::SqliteFailure(
            FfiError {
                code: ErrorCode::DatabaseBusy,
                extended_code: 0,
            },
            Some(err.to_string()),
        )
    }

    /// Borrow a pooled connection
    pub fn connection(&self) -> SqlResult<PooledConnection<SqliteConnectionManager>> {
        self.pool.get().map_err(Self::map_pool_error)
    }

    /// Initialize the database schema
    pub fn init_schema(&self) -> SqlResult<()> {
        let conn = self.connection()?;
        initialise_schema(&conn)?;
        Ok(())
    }

    /// Check if a position hash exists in the database
    pub fn position_exists(&self, hash: u64) -> SqlResult<bool> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT 1 FROM positions WHERE hash = ?1")?;
        let exists = stmt.exists([hash as i64])?;
        Ok(exists)
    }

    /// Get the maximum depth in the database
    pub fn get_max_depth(&self) -> SqlResult<u32> {
        let conn = self.connection()?;
        let max_depth: i32 = conn.query_row(
            "SELECT COALESCE(MAX(depth), 0) FROM positions",
            [],
            |row| row.get(0),
        )?;
        Ok(max_depth as u32)
    }

    /// Get all positions at a specific depth
    pub fn get_positions_at_depth(&self, depth: u32) -> SqlResult<Vec<(u64, String)>> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare("SELECT hash, fen FROM positions WHERE depth = ?1")?;

        let positions: Vec<(u64, String)> = stmt
            .query_map([depth as i32], |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, String>(1)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(positions)
    }

    /// Expose underlying pool for advanced usage (e.g., caching layers)
    pub fn pool(&self) -> Arc<Pool<SqliteConnectionManager>> {
        self.pool.clone()
    }
}

fn configure_connection(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 134217728;",
    )?;
    Ok(())
}

fn initialise_schema(conn: &Connection) -> SqlResult<()> {
    // Create positions table
    println!("Creating positions table...");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS positions (
            hash INTEGER PRIMARY KEY,
            fen TEXT NOT NULL,
            depth INTEGER NOT NULL,
            parent_hash INTEGER,
            move_sequence TEXT,
            child_count INTEGER DEFAULT 0,
            evaluation_score INTEGER,
            best_move TEXT,
            game_result TEXT
        )",
        [],
    )?;
    println!("Positions table ensured.");

    // Migrate existing databases by adding new columns if they don't exist
    let _ = conn.execute(
        "ALTER TABLE positions ADD COLUMN evaluation_score INTEGER",
        params![],
    );
    let _ = conn.execute("ALTER TABLE positions ADD COLUMN best_move TEXT", params![]);
    let _ = conn.execute(
        "ALTER TABLE positions ADD COLUMN game_result TEXT",
        params![],
    );

    // Create edges table for move relationships
    println!("Creating edges table...");
    conn.execute(
        "CREATE TABLE IF NOT EXISTS edges (
            parent_hash INTEGER NOT NULL,
            child_hash INTEGER NOT NULL,
            move_uci TEXT NOT NULL,
            move_index INTEGER NOT NULL,
            PRIMARY KEY (parent_hash, child_hash)
        )",
        [],
    )?;
    println!("Edges table ensured.");

    // Create indexes for faster queries
    println!("Creating indexes...");
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_depth ON positions(depth)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_hash)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_move_sequence ON positions(move_sequence)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_fen ON positions(fen)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_edges_parent ON edges(parent_hash)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_hash)",
        [],
    )?;
    println!("Indexes ensured.");

    Ok(())
}