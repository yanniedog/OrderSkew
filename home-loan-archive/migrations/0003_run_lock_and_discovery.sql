-- 0003_run_lock_and_discovery.sql
-- Run locking (idempotent daily run) and CDR discovery cache support.

-- Single lock per run_type+date to prevent duplicate cron runs.
CREATE TABLE IF NOT EXISTS run_locks (
  lock_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Add columns to lender_endpoints_cache if missing (D1/SQLite ADD COLUMN).
-- Existing: lender_key, brand_id, product_reference_data_api, discovered_at, expires_at
ALTER TABLE lender_endpoints_cache ADD COLUMN brand_name TEXT;
ALTER TABLE lender_endpoints_cache ADD COLUMN api_base_url TEXT;
ALTER TABLE lender_endpoints_cache ADD COLUMN products_url TEXT;
ALTER TABLE lender_endpoints_cache ADD COLUMN last_seen_at TEXT;
ALTER TABLE lender_endpoints_cache ADD COLUMN raw_json TEXT;

-- Optional index for admin queries by lender_key.
CREATE INDEX IF NOT EXISTS idx_lender_endpoints_cache_lender_key
  ON lender_endpoints_cache(lender_key);

CREATE INDEX IF NOT EXISTS idx_lender_endpoints_cache_last_seen
  ON lender_endpoints_cache(last_seen_at);

-- Allow storing inline JSON for CDR register payload (small enough).
ALTER TABLE raw_payloads ADD COLUMN payload_json TEXT;
