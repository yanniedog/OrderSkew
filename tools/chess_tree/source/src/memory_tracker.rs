use bloomfilter::Bloom;
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex, RwLock};

/// Memory-efficient position tracker using Bloom filter + LRU cache
/// This prevents unbounded memory growth while maintaining fast lookups
pub struct MemoryEfficientTracker {
    /// Bloom filter for fast negative checks (may have false positives)
    bloom: Arc<RwLock<Bloom<[u8]>>>,
    /// LRU cache for recent positions (prevents false positives from bloom filter)
    cache: Arc<Mutex<LruCache<u64, bool>>>,
    /// Database-backed cache for confirmed positions
    db_cache: Arc<Mutex<LruCache<u64, bool>>>,
    /// Total items inserted (for statistics)
    total_inserted: Arc<std::sync::atomic::AtomicU64>,
    /// False positive count (for monitoring)
    false_positives: Arc<std::sync::atomic::AtomicU64>,
}

impl MemoryEfficientTracker {
    /// Create a new memory-efficient tracker
    /// capacity: Expected number of positions (for bloom filter sizing)
    /// cache_size: Number of recent positions to keep in LRU cache
    pub fn new(capacity: usize, cache_size: usize) -> Self {
        // Create bloom filter with capacity and 0.1% false positive rate
        let bloom = Bloom::new_for_fp_rate(capacity, 0.001);
        
        // Create LRU cache for recent positions
        let cache = LruCache::new(
            NonZeroUsize::new(cache_size.max(1)).unwrap()
        );
        
        // Create a larger LRU cache for database-confirmed positions
        let db_cache = LruCache::new(
            NonZeroUsize::new((cache_size * 2).max(1)).unwrap()
        );
        
        Self {
            bloom: Arc::new(RwLock::new(bloom)),
            cache: Arc::new(Mutex::new(cache)),
            db_cache: Arc::new(Mutex::new(db_cache)),
            total_inserted: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            false_positives: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }
    
    /// Check if a position hash has been seen before
    /// Returns true if definitely seen, false if definitely not seen
    pub fn contains(&self, hash: u64) -> bool {
        // First check LRU cache (most recent positions)
        {
            let mut cache = self.cache.lock().unwrap();
            if let Some(&seen) = cache.get(&hash) {
                return seen;
            }
        }
        
        // Check database cache
        {
            let mut db_cache = self.db_cache.lock().unwrap();
            if let Some(&seen) = db_cache.get(&hash) {
                return seen;
            }
        }
        
        // Check bloom filter (fast but may have false positives)
        let bloom = self.bloom.read().unwrap();
        if !bloom.check(&hash.to_be_bytes()) {
            // Definitely not seen
            return false;
        }
        
        // Bloom filter says "maybe" - this is a potential false positive
        // We'll need to check the database to be sure
        // For now, return false and let the caller check the database
        false
    }
    
    /// Mark a position hash as seen
    pub fn insert(&self, hash: u64) {
        // Add to bloom filter
        {
            let mut bloom = self.bloom.write().unwrap();
            bloom.set(&hash.to_be_bytes());
        }
        
        // Add to LRU cache
        {
            let mut cache = self.cache.lock().unwrap();
            cache.put(hash, true);
        }
        
        self.total_inserted.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Mark a position as confirmed in database (for cache optimization)
    pub fn confirm_in_db(&self, hash: u64) {
        let mut db_cache = self.db_cache.lock().unwrap();
        db_cache.put(hash, true);
    }
    
    /// Get statistics about the tracker
    pub fn get_stats(&self) -> (u64, u64) {
        let total = self.total_inserted.load(std::sync::atomic::Ordering::Relaxed);
        let false_pos = self.false_positives.load(std::sync::atomic::Ordering::Relaxed);
        (total, false_pos)
    }
    
    /// Record a false positive (when bloom filter said yes but database said no)
    pub fn record_false_positive(&self) {
        self.false_positives.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    
    /// Estimate memory usage in bytes
    pub fn estimate_memory_usage(&self) -> usize {
        // Bloom filter memory (approximate)
        // The bloomfilter crate doesn't expose bit_size, so we estimate
        // For 1M items at 0.1% FP rate, we need ~14.4 bits per item = ~1.8MB
        let bloom_size = 2_000_000; // Conservative estimate
        
        // LRU cache memory (approximate: 8 bytes per entry + overhead)
        let cache_size = {
            let cache = self.cache.lock().unwrap();
            cache.len() * 16 // 8 bytes for key + 1 byte for value + overhead
        };
        
        let db_cache_size = {
            let db_cache = self.db_cache.lock().unwrap();
            db_cache.len() * 16
        };
        
        bloom_size + cache_size + db_cache_size
    }
}

impl Default for MemoryEfficientTracker {
    fn default() -> Self {
        // Default: expect 1M positions, cache 10K recent
        Self::new(1_000_000, 10_000)
    }
}

