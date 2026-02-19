use crate::memory_tracker::MemoryEfficientTracker;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::{System, Pid};

/// Progress tracking with atomic counters
pub struct ProgressTracker {
    nodes_expanded: AtomicU64,
    positions_inserted: AtomicU64,
    duplicates_skipped: AtomicU64,
    start_time: Instant,
    running: Arc<std::sync::atomic::AtomicBool>,
    memory_tracker: Option<Arc<MemoryEfficientTracker>>,
}

impl ProgressTracker {
    /// Create a new progress tracker
    pub fn new() -> Self {
        Self {
            nodes_expanded: AtomicU64::new(0),
            positions_inserted: AtomicU64::new(0),
            duplicates_skipped: AtomicU64::new(0),
            start_time: Instant::now(),
            running: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            memory_tracker: None,
        }
    }
    
    /// Set the memory tracker for memory usage monitoring
    pub fn set_memory_tracker(&mut self, tracker: Arc<MemoryEfficientTracker>) {
        self.memory_tracker = Some(tracker);
    }
    
    /// Increment nodes expanded counter
    pub fn increment_expanded(&self) {
        self.nodes_expanded.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Increment positions inserted counter
    pub fn increment_inserted(&self) {
        self.positions_inserted.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Increment duplicates skipped counter
    pub fn increment_duplicates(&self) {
        self.duplicates_skipped.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Get current statistics
    pub fn get_stats(&self) -> (u64, u64, u64, f64) {
        let expanded = self.nodes_expanded.load(Ordering::Relaxed);
        let inserted = self.positions_inserted.load(Ordering::Relaxed);
        let duplicates = self.duplicates_skipped.load(Ordering::Relaxed);
        let elapsed = self.start_time.elapsed().as_secs_f64();
        let rate = if elapsed > 0.0 {
            expanded as f64 / elapsed
        } else {
            0.0
        };
        (expanded, inserted, duplicates, rate)
    }
    
    /// Get memory usage statistics
    pub fn get_memory_stats(&self) -> Option<(u64, u64, u64)> {
        let mut system = System::new_all();
        system.refresh_all();
        
        // Get process memory usage
        let pid = Pid::from(std::process::id() as usize);
        let process = system.process(pid)?;
        let process_memory = process.memory();
        
        // Get tracker memory if available
        if let Some(tracker) = &self.memory_tracker {
            let tracker_memory = tracker.estimate_memory_usage();
            let (_total_tracked, false_positives) = tracker.get_stats();
            Some((process_memory, tracker_memory as u64, false_positives))
        } else {
            Some((process_memory, 0, 0))
        }
    }
    
    /// Start progress reporting thread
    /// Note: This should be called on an Arc<ProgressTracker> for proper sharing
    pub fn start_reporting_arc(tracker: Arc<Self>, interval_secs: u64) {
        let running = tracker.running.clone();
        let tracker_clone = tracker.clone();
        
        thread::spawn(move || {
            while running.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(interval_secs));
                let (expanded, inserted, duplicates, rate) = tracker_clone.get_stats();
                let elapsed = tracker_clone.start_time.elapsed();
                
                // Get memory stats if available
                if let Some((process_mem, tracker_mem, false_pos)) = tracker_clone.get_memory_stats() {
                    let process_mem_mb = process_mem as f64 / 1024.0 / 1024.0;
                    let tracker_mem_mb = tracker_mem as f64 / 1024.0 / 1024.0;
                    println!(
                        "\r[Progress] Expanded: {} | Inserted: {} | Duplicates: {} | Rate: {:.0} nodes/sec | Memory: {:.1}MB (tracker: {:.1}MB, FP: {}) | Elapsed: {:?}",
                        expanded, inserted, duplicates, rate, process_mem_mb, tracker_mem_mb, false_pos, elapsed
                    );
                } else {
                    println!(
                        "\r[Progress] Expanded: {} | Inserted: {} | Duplicates: {} | Rate: {:.0} nodes/sec | Elapsed: {:?}",
                        expanded, inserted, duplicates, rate, elapsed
                    );
                }
            }
        });
    }
    
    /// Start progress reporting thread (convenience method that works with &self)
    /// This creates a temporary Arc for the thread
    pub fn start_reporting(&self, interval_secs: u64) {
        Self::start_reporting_arc(Arc::new(self.clone()), interval_secs);
    }
    
    /// Stop progress reporting
    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }
    
    /// Print final statistics
    pub fn print_final(&self) {
        let (expanded, inserted, duplicates, rate) = self.get_stats();
        let elapsed = self.start_time.elapsed();
        
        println!("\n=== Final Statistics ===");
        println!("Nodes expanded: {}", expanded);
        println!("Positions inserted: {}", inserted);
        println!("Duplicates skipped: {}", duplicates);
        println!("Average rate: {:.2} nodes/sec", rate);
        println!("Total time: {:?}", elapsed);
    }
}

// ProgressTracker should not be cloned - use Arc instead
// The Clone implementation below is only for the reporting thread which reads values
impl Clone for ProgressTracker {
    fn clone(&self) -> Self {
        // This creates a new tracker that shares the same atomic values
        // by reading current values. This is only used for the reporting thread
        // which doesn't need to write, so it's acceptable.
        Self {
            nodes_expanded: AtomicU64::new(self.nodes_expanded.load(Ordering::Relaxed)),
            positions_inserted: AtomicU64::new(self.positions_inserted.load(Ordering::Relaxed)),
            duplicates_skipped: AtomicU64::new(self.duplicates_skipped.load(Ordering::Relaxed)),
            start_time: self.start_time,
            running: self.running.clone(),
            memory_tracker: self.memory_tracker.clone(),
        }
    }
}

impl Default for ProgressTracker {
    fn default() -> Self {
        Self::new()
    }
}

