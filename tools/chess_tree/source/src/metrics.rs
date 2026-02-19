use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Performance metrics collector
pub struct MetricsCollector {
    positions_per_second: Arc<AtomicU64>,
    memory_usage_bytes: Arc<AtomicU64>,
    database_operations: Arc<AtomicU64>,
    database_latency_ms: Arc<AtomicU64>,
    cache_hits: Arc<AtomicU64>,
    cache_misses: Arc<AtomicU64>,
    start_time: Instant,
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self {
            positions_per_second: Arc::new(AtomicU64::new(0)),
            memory_usage_bytes: Arc::new(AtomicU64::new(0)),
            database_operations: Arc::new(AtomicU64::new(0)),
            database_latency_ms: Arc::new(AtomicU64::new(0)),
            cache_hits: Arc::new(AtomicU64::new(0)),
            cache_misses: Arc::new(AtomicU64::new(0)),
            start_time: Instant::now(),
        }
    }
    
    pub fn record_position_processed(&self) {
        self.positions_per_second.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn update_memory_usage(&self, bytes: u64) {
        self.memory_usage_bytes.store(bytes, Ordering::Relaxed);
    }
    
    pub fn record_database_operation(&self, latency_ms: u64) {
        self.database_operations.fetch_add(1, Ordering::Relaxed);
        self.database_latency_ms.fetch_add(latency_ms, Ordering::Relaxed);
    }
    
    pub fn record_cache_hit(&self) {
        self.cache_hits.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn record_cache_miss(&self) {
        self.cache_misses.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn get_metrics(&self) -> MetricsSnapshot {
        let elapsed = self.start_time.elapsed().as_secs_f64();
        let positions = self.positions_per_second.load(Ordering::Relaxed);
        let positions_per_sec = if elapsed > 0.0 {
            positions as f64 / elapsed
        } else {
            0.0
        };
        
        let db_ops = self.database_operations.load(Ordering::Relaxed);
        let db_latency_total = self.database_latency_ms.load(Ordering::Relaxed);
        let avg_db_latency = if db_ops > 0 {
            db_latency_total as f64 / db_ops as f64
        } else {
            0.0
        };
        
        let cache_hits = self.cache_hits.load(Ordering::Relaxed);
        let cache_misses = self.cache_misses.load(Ordering::Relaxed);
        let cache_hit_rate = if cache_hits + cache_misses > 0 {
            cache_hits as f64 / (cache_hits + cache_misses) as f64
        } else {
            0.0
        };
        
        MetricsSnapshot {
            positions_processed: positions,
            positions_per_second: positions_per_sec,
            memory_usage_bytes: self.memory_usage_bytes.load(Ordering::Relaxed),
            database_operations: db_ops,
            average_database_latency_ms: avg_db_latency,
            cache_hits,
            cache_misses,
            cache_hit_rate,
            elapsed_seconds: elapsed,
        }
    }
    
    pub fn print_summary(&self) {
        let metrics = self.get_metrics();
        println!("\n=== Performance Metrics ===");
        println!("Positions processed: {}", metrics.positions_processed);
        println!("Throughput: {:.2} positions/sec", metrics.positions_per_second);
        println!("Memory usage: {:.2} MB", metrics.memory_usage_bytes as f64 / 1024.0 / 1024.0);
        println!("Database operations: {}", metrics.database_operations);
        println!("Average DB latency: {:.2} ms", metrics.average_database_latency_ms);
        println!("Cache hit rate: {:.2}%", metrics.cache_hit_rate * 100.0);
        println!("Elapsed time: {:.2} seconds", metrics.elapsed_seconds);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MetricsSnapshot {
    pub positions_processed: u64,
    pub positions_per_second: f64,
    pub memory_usage_bytes: u64,
    pub database_operations: u64,
    pub average_database_latency_ms: f64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cache_hit_rate: f64,
    pub elapsed_seconds: f64,
}

impl Default for MetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

