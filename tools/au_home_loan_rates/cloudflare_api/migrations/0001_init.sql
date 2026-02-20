PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS historical_loan_rates (
  bank_name TEXT NOT NULL,
  collection_date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  security_purpose TEXT NOT NULL CHECK (security_purpose IN ('owner_occupied', 'investment')),
  repayment_type TEXT NOT NULL CHECK (repayment_type IN ('principal_and_interest', 'interest_only')),
  rate_structure TEXT NOT NULL CHECK (rate_structure IN ('variable', 'fixed_1yr', 'fixed_2yr', 'fixed_3yr', 'fixed_4yr', 'fixed_5yr')),
  lvr_tier TEXT NOT NULL CHECK (lvr_tier IN ('lvr_=60%', 'lvr_60-70%', 'lvr_70-80%', 'lvr_80-85%', 'lvr_85-90%', 'lvr_90-95%')),
  feature_set TEXT NOT NULL CHECK (feature_set IN ('basic', 'premium')),
  interest_rate REAL NOT NULL,
  comparison_rate REAL,
  annual_fee REAL,
  source_url TEXT NOT NULL,
  data_quality_flag TEXT NOT NULL DEFAULT 'ok',
  confidence_score REAL NOT NULL DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  parsed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bank_name, collection_date, product_id, lvr_tier, rate_structure)
);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_collection_date
  ON historical_loan_rates(collection_date);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_bank_date
  ON historical_loan_rates(bank_name, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_historical_loan_rates_product
  ON historical_loan_rates(product_id, rate_structure, lvr_tier);

CREATE TABLE IF NOT EXISTS raw_payloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('cdr_register', 'cdr_products', 'cdr_product_detail', 'wayback_html')),
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  http_status INTEGER,
  notes TEXT,
  UNIQUE(source_type, source_url, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_fetched_at
  ON raw_payloads(fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_source_type
  ON raw_payloads(source_type, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_payloads_content_hash
  ON raw_payloads(content_hash);

CREATE TABLE IF NOT EXISTS run_reports (
  run_id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL CHECK (run_type IN ('daily', 'backfill')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  per_lender_json TEXT NOT NULL DEFAULT '{}',
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_run_reports_started_at
  ON run_reports(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_reports_status
  ON run_reports(status, started_at DESC);

CREATE TABLE IF NOT EXISTS lender_endpoint_cache (
  lender_code TEXT PRIMARY KEY,
  endpoint_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  source_url TEXT,
  http_status INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_lender_endpoint_cache_expires_at
  ON lender_endpoint_cache(expires_at);

CREATE TABLE IF NOT EXISTS brand_normalization_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_brand_name TEXT NOT NULL UNIQUE,
  canonical_bank_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backfill_cursors (
  cursor_key TEXT PRIMARY KEY,
  run_id TEXT,
  lender_code TEXT,
  seed_url TEXT NOT NULL,
  month_cursor TEXT NOT NULL,
  last_snapshot_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_backfill_cursors_status
  ON backfill_cursors(status, updated_at DESC);

CREATE VIEW IF NOT EXISTS vw_latest_rates AS
WITH ranked AS (
  SELECT
    bank_name,
    collection_date,
    product_id,
    product_name,
    security_purpose,
    repayment_type,
    rate_structure,
    lvr_tier,
    feature_set,
    interest_rate,
    comparison_rate,
    annual_fee,
    source_url,
    data_quality_flag,
    confidence_score,
    parsed_at,
    bank_name || '|' || product_id || '|' || lvr_tier || '|' || rate_structure AS product_key,
    ROW_NUMBER() OVER (
      PARTITION BY bank_name, product_id, lvr_tier, rate_structure
      ORDER BY collection_date DESC, parsed_at DESC
    ) AS row_num
  FROM historical_loan_rates
)
SELECT
  bank_name,
  collection_date,
  product_id,
  product_name,
  security_purpose,
  repayment_type,
  rate_structure,
  lvr_tier,
  feature_set,
  interest_rate,
  comparison_rate,
  annual_fee,
  source_url,
  data_quality_flag,
  confidence_score,
  parsed_at,
  product_key
FROM ranked
WHERE row_num = 1;

CREATE VIEW IF NOT EXISTS vw_rate_timeseries AS
SELECT
  collection_date,
  bank_name,
  product_id,
  product_name,
  lvr_tier,
  rate_structure,
  interest_rate,
  comparison_rate,
  annual_fee,
  data_quality_flag,
  confidence_score,
  source_url,
  bank_name || '|' || product_id || '|' || lvr_tier || '|' || rate_structure AS product_key
FROM historical_loan_rates;