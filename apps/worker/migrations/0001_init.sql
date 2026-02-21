PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bootstrap_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootstrap_events_created_at
ON bootstrap_events(created_at DESC);