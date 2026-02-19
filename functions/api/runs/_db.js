const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
  });
}

function nowMs() {
  return Date.now();
}

function pickDb(env) {
  return env && (env.RUNS_DB || env.DB) ? (env.RUNS_DB || env.DB) : null;
}

async function ensureSchema(db) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS run_sessions (
      run_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      summary_json TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS loop_metrics (
      run_id TEXT NOT NULL,
      loop_no INTEGER NOT NULL,
      reward REAL NOT NULL DEFAULT 0,
      within_budget_count INTEGER NOT NULL DEFAULT 0,
      over_budget_count INTEGER NOT NULL DEFAULT 0,
      considered_count INTEGER NOT NULL DEFAULT 0,
      average_overall_score REAL NOT NULL DEFAULT 0,
      average_value_ratio REAL NOT NULL DEFAULT 0,
      underpriced_count INTEGER NOT NULL DEFAULT 0,
      exploration_rate REAL NOT NULL DEFAULT 0,
      keywords TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (run_id, loop_no)
    )`,
    `CREATE TABLE IF NOT EXISTS undervalued_domains (
      domain TEXT PRIMARY KEY,
      best_value_ratio REAL NOT NULL DEFAULT 0,
      best_overall_score REAL NOT NULL DEFAULT 0,
      best_estimated_value REAL NOT NULL DEFAULT 0,
      best_price REAL,
      times_seen INTEGER NOT NULL DEFAULT 0,
      times_within_budget INTEGER NOT NULL DEFAULT 0,
      times_over_budget INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_run_id TEXT,
      last_keywords TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS reward_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      policy_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ];
  const batch = stmts.map((sql) => db.prepare(sql));
  await db.batch(batch);
}

function defaultPolicy() {
  return {
    performanceVsExploration: 0.78,
    quotaWeight: 0.22,
    undervalueWeight: 0.24,
    qualityWeight: 0.24,
    availabilityWeight: 0.18,
    inBudgetWeight: 0.12,
    runCount: 0,
    movingCoverage: 0.5,
    movingPerformance: 0.5,
    movingUndervaluation: 0.5,
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function parsePolicy(raw) {
  let p = null;
  try {
    p = raw ? JSON.parse(raw) : null;
  } catch {
    p = null;
  }
  const d = defaultPolicy();
  if (!p || typeof p !== "object") return d;
  return {
    performanceVsExploration: clamp(Number(p.performanceVsExploration) || d.performanceVsExploration, 0.55, 0.95),
    quotaWeight: clamp(Number(p.quotaWeight) || d.quotaWeight, 0.10, 0.35),
    undervalueWeight: clamp(Number(p.undervalueWeight) || d.undervalueWeight, 0.10, 0.40),
    qualityWeight: clamp(Number(p.qualityWeight) || d.qualityWeight, 0.10, 0.40),
    availabilityWeight: clamp(Number(p.availabilityWeight) || d.availabilityWeight, 0.08, 0.35),
    inBudgetWeight: clamp(Number(p.inBudgetWeight) || d.inBudgetWeight, 0.05, 0.30),
    runCount: Math.max(0, Number(p.runCount) || 0),
    movingCoverage: clamp(Number(p.movingCoverage) || d.movingCoverage, 0, 1),
    movingPerformance: clamp(Number(p.movingPerformance) || d.movingPerformance, 0, 1),
    movingUndervaluation: clamp(Number(p.movingUndervaluation) || d.movingUndervaluation, 0, 1),
  };
}

function compactPolicyForClient(policy) {
  return {
    performanceVsExploration: policy.performanceVsExploration,
    quotaWeight: policy.quotaWeight,
    undervalueWeight: policy.undervalueWeight,
    qualityWeight: policy.qualityWeight,
    availabilityWeight: policy.availabilityWeight,
    inBudgetWeight: policy.inBudgetWeight,
  };
}

async function loadPolicy(db) {
  const row = await db.prepare("SELECT policy_json, updated_at FROM reward_state WHERE id = 1").first();
  if (!row || !row.policy_json) return { policy: defaultPolicy(), updatedAt: null };
  return { policy: parsePolicy(row.policy_json), updatedAt: Number(row.updated_at) || null };
}

async function savePolicy(db, policy) {
  const updatedAt = nowMs();
  await db.prepare(
    "INSERT INTO reward_state (id, policy_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at"
  ).bind(JSON.stringify(policy), updatedAt).run();
  return updatedAt;
}

function adaptPolicy(current, metrics) {
  const p = parsePolicy(JSON.stringify(current || defaultPolicy()));
  const alpha = 0.18;
  const coverage = clamp(Number(metrics.coverageScore) || 0, 0, 1);
  const performance = clamp(Number(metrics.performanceScore) || 0, 0, 1);
  const undervaluation = clamp(Number(metrics.undervaluationScore) || 0, 0, 1);
  p.movingCoverage = p.movingCoverage * (1 - alpha) + coverage * alpha;
  p.movingPerformance = p.movingPerformance * (1 - alpha) + performance * alpha;
  p.movingUndervaluation = p.movingUndervaluation * (1 - alpha) + undervaluation * alpha;
  p.runCount += 1;

  const coverageGap = clamp(0.62 - p.movingCoverage, -0.4, 0.4);
  const performanceGap = clamp(0.68 - p.movingPerformance, -0.4, 0.4);
  const undervalueGap = clamp(0.58 - p.movingUndervaluation, -0.4, 0.4);

  p.performanceVsExploration = clamp(
    p.performanceVsExploration + (-coverageGap * 0.12) + (performanceGap * 0.08),
    0.55,
    0.95
  );
  p.quotaWeight = clamp(p.quotaWeight + performanceGap * 0.03 + coverageGap * 0.02, 0.10, 0.35);
  p.undervalueWeight = clamp(p.undervalueWeight + undervalueGap * 0.04, 0.10, 0.40);
  p.qualityWeight = clamp(p.qualityWeight + performanceGap * 0.03, 0.10, 0.40);
  p.availabilityWeight = clamp(p.availabilityWeight + performanceGap * 0.02 + coverageGap * 0.02, 0.08, 0.35);
  p.inBudgetWeight = clamp(p.inBudgetWeight + performanceGap * 0.02 + coverageGap * 0.03, 0.05, 0.30);
  return p;
}

export {
  CORS,
  json,
  clamp,
  nowMs,
  pickDb,
  ensureSchema,
  defaultPolicy,
  parsePolicy,
  compactPolicyForClient,
  loadPolicy,
  savePolicy,
  adaptPolicy,
};
