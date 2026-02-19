import {
  CORS,
  json,
  pickDb,
  ensureSchema,
  loadPolicy,
  compactPolicyForClient,
} from "./_db.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const db = pickDb(context.env);
  if (!db) {
    return json({
      enabled: false,
      message: "Persistent run database is not configured. Bind RUNS_DB (D1).",
      rewardPolicy: null,
      topUndervaluedDomains: [],
    }, 200);
  }

  try {
    await ensureSchema(db);
    const limit = Math.min(100, Math.max(5, Number(new URL(context.request.url).searchParams.get("limit")) || 20));
    const { policy, updatedAt } = await loadPolicy(db);

    const topRows = await db.prepare(
      `SELECT
        domain, best_value_ratio, best_overall_score, best_estimated_value, best_price,
        times_seen, times_within_budget, times_over_budget, first_seen_at, last_seen_at, last_run_id, last_keywords
       FROM undervalued_domains
       ORDER BY best_value_ratio DESC, best_overall_score DESC, times_within_budget DESC
       LIMIT ?`
    ).bind(limit).all();

    const runCountRow = await db.prepare("SELECT COUNT(*) AS c FROM run_sessions").first();
    const runCount = Number(runCountRow && runCountRow.c) || 0;

    return json({
      enabled: true,
      rewardPolicy: compactPolicyForClient(policy),
      rewardPolicyMeta: {
        runCount: policy.runCount,
        movingCoverage: policy.movingCoverage,
        movingPerformance: policy.movingPerformance,
        movingUndervaluation: policy.movingUndervaluation,
        updatedAt,
      },
      runCount,
      topUndervaluedDomains: (topRows && topRows.results ? topRows.results : []).map((r) => ({
        domain: String(r.domain || ""),
        bestValueRatio: Number(r.best_value_ratio) || 0,
        bestOverallScore: Number(r.best_overall_score) || 0,
        bestEstimatedValue: Number(r.best_estimated_value) || 0,
        bestPrice: r.best_price == null ? null : Number(r.best_price),
        timesSeen: Number(r.times_seen) || 0,
        timesWithinBudget: Number(r.times_within_budget) || 0,
        timesOverBudget: Number(r.times_over_budget) || 0,
        firstSeenAt: Number(r.first_seen_at) || 0,
        lastSeenAt: Number(r.last_seen_at) || 0,
        lastRunId: r.last_run_id || null,
        lastKeywords: r.last_keywords || "",
      })),
    }, 200);
  } catch (err) {
    return json({
      enabled: false,
      message: "Failed to load persistent profile.",
      error: err && err.message ? err.message : String(err || "unknown"),
      rewardPolicy: null,
      topUndervaluedDomains: [],
    }, 500);
  }
}
