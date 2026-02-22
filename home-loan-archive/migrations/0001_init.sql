CREATE TABLE IF NOT EXISTS raw_payloads (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT,
  r2_key TEXT,
  http_status INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS run_reports (
  run_id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  per_lender_json TEXT,
  errors_json TEXT
);

CREATE TABLE IF NOT EXISTS lender_endpoints_cache (
  lender_key TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  product_reference_data_api TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (lender_key, brand_id)
);
