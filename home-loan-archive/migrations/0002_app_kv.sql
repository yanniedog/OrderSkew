-- 0002_app_kv.sql
-- Simple key-value table for internal application state (eg queue test markers)

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Optional index (not strictly necessary because key is PRIMARY KEY,
-- but left here for clarity if schema evolves later)
CREATE INDEX IF NOT EXISTS idx_app_kv_updated_at
ON app_kv(updated_at);