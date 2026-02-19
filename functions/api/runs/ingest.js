import {
  CORS,
  json,
  clamp,
  nowMs,
  pickDb,
  ensureSchema,
  loadPolicy,
  savePolicy,
  adaptPolicy,
  compactPolicyForClient,
} from "./_db.js";

function tokenizeKeywords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/[\s-]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const db = pickDb(context.env);
  if (!db) {
    return json({ ok: false, enabled: false, message: "Persistent run database is not configured. Bind RUNS_DB (D1)." }, 200);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, code: "INVALID_REQUEST", message: "JSON body required." }, 400);
  }

  if (!body || typeof body !== "object") {
    return json({ ok: false, code: "INVALID_REQUEST", message: "Body must be an object." }, 400);
  }

  const runId = String(body.runId || "").trim();
  const run = body.run && typeof body.run === "object" ? body.run : {};
  const results = body.results && typeof body.results === "object" ? body.results : {};
  const input = body.input && typeof body.input === "object" ? body.input : {};
  if (!runId) return json({ ok: false, code: "INVALID_REQUEST", message: "runId is required." }, 400);

  const completedAt = Number(run.completedAt || nowMs());
  const createdAt = Number(run.createdAt || completedAt);
  const withinBudgetRows = Array.isArray(results.withinBudget) ? results.withinBudget : [];
  const overBudgetRows = Array.isArray(results.overBudget) ? results.overBudget : [];
  const allRankedRows = Array.isArray(results.allRanked) ? results.allRanked : [];
  const loopSummaries = Array.isArray(results.loopSummaries) ? results.loopSummaries : [];
  const tuningHistory = Array.isArray(results.tuningHistory) ? results.tuningHistory : [];
  const candidateRows = allRankedRows.length ? allRankedRows : withinBudgetRows.concat(overBudgetRows);

  const uniqueTokens = new Set();
  for (const t of tuningHistory) {
    for (const token of tokenizeKeywords(t && t.keywords)) uniqueTokens.add(token);
  }
  const topWithin = withinBudgetRows
    .slice()
    .sort((a, b) => (Number(b.overallScore) || 0) - (Number(a.overallScore) || 0))
    .slice(0, 10);
  const avgOverallTopWithin = topWithin.length
    ? topWithin.reduce((s, r) => s + (Number(r.overallScore) || 0), 0) / topWithin.length
    : 0;
  const undervRows = withinBudgetRows.filter((r) => (Number(r.valueRatio) || 0) >= 3);
  const avgUnderv = undervRows.length
    ? undervRows.reduce((s, r) => s + (Number(r.valueRatio) || 0), 0) / undervRows.length
    : 0;

  const summary = {
    withinBudgetCount: withinBudgetRows.length,
    overBudgetCount: overBudgetRows.length,
    allRankedCount: allRankedRows.length,
    consideredTotal: loopSummaries.reduce((s, l) => s + (Number(l && l.consideredCount) || 0), 0),
    avgOverallTopWithin: Number(avgOverallTopWithin.toFixed(3)),
    avgUndervalueRatio: Number(avgUnderv.toFixed(3)),
    underpricedCount: undervRows.length,
    uniqueKeywordCount: uniqueTokens.size,
    loopCount: Number(input.loopCount) || Number(run.totalLoops) || 0,
    maxNames: Number(input.maxNames) || 0,
  };

  try {
    await ensureSchema(db);
    await db.prepare(
      "INSERT INTO run_sessions (run_id, created_at, completed_at, config_json, summary_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET completed_at = excluded.completed_at, config_json = excluded.config_json, summary_json = excluded.summary_json"
    ).bind(
      runId,
      createdAt,
      completedAt,
      JSON.stringify({
        keywords: String(input.keywords || run.input && run.input.keywords || ""),
        description: String(input.description || run.input && run.input.description || ""),
        loopCount: Number(input.loopCount || run.totalLoops || 0),
        maxNames: Number(input.maxNames || 0),
        yearlyBudget: Number(input.yearlyBudget || 0),
      }),
      JSON.stringify(summary)
    ).run();

    const loopBatch = [];
    for (const loop of loopSummaries.slice(0, 500)) {
      loopBatch.push(
        db.prepare(
          "INSERT INTO loop_metrics (run_id, loop_no, reward, within_budget_count, over_budget_count, considered_count, average_overall_score, average_value_ratio, underpriced_count, exploration_rate, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, loop_no) DO UPDATE SET reward = excluded.reward, within_budget_count = excluded.within_budget_count, over_budget_count = excluded.over_budget_count, considered_count = excluded.considered_count, average_overall_score = excluded.average_overall_score, average_value_ratio = excluded.average_value_ratio, underpriced_count = excluded.underpriced_count, exploration_rate = excluded.exploration_rate, keywords = excluded.keywords"
        ).bind(
          runId,
          Number(loop.loop) || 0,
          Number(loop.reward) || 0,
          Number(loop.withinBudgetCount) || 0,
          Number(loop.overBudgetCount) || 0,
          Number(loop.consideredCount) || 0,
          Number(loop.averageOverallScore) || 0,
          Number(loop.averageValueRatio) || 0,
          Number(loop.underpricedCount) || 0,
          Number(loop.explorationRate) || 0,
          String(loop.keywords || "")
        )
      );
    }
    if (loopBatch.length) await db.batch(loopBatch);

    const domainBatch = [];
    for (const row of candidateRows.slice(0, 1000)) {
      const domain = String(row.domain || "").toLowerCase().trim();
      if (!domain) continue;
      const valueRatio = Number(row.valueRatio) || 0;
      const overallScore = Number(row.overallScore) || 0;
      const estimatedValue = Number(row.estimatedValueUSD) || 0;
      const price = row.price == null ? null : Number(row.price);
      const withinBudget = Boolean(row.available) && !Boolean(row.overBudget);
      const overBudget = Boolean(row.available) && Boolean(row.overBudget);
      domainBatch.push(
        db.prepare(
          `INSERT INTO undervalued_domains
            (domain, best_value_ratio, best_overall_score, best_estimated_value, best_price, times_seen, times_within_budget, times_over_budget, first_seen_at, last_seen_at, last_run_id, last_keywords)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(domain) DO UPDATE SET
             best_value_ratio = MAX(undervalued_domains.best_value_ratio, excluded.best_value_ratio),
             best_overall_score = MAX(undervalued_domains.best_overall_score, excluded.best_overall_score),
             best_estimated_value = MAX(undervalued_domains.best_estimated_value, excluded.best_estimated_value),
             best_price = CASE
               WHEN undervalued_domains.best_price IS NULL THEN excluded.best_price
               WHEN excluded.best_price IS NULL THEN undervalued_domains.best_price
               ELSE MIN(undervalued_domains.best_price, excluded.best_price)
             END,
             times_seen = undervalued_domains.times_seen + 1,
             times_within_budget = undervalued_domains.times_within_budget + excluded.times_within_budget,
             times_over_budget = undervalued_domains.times_over_budget + excluded.times_over_budget,
             last_seen_at = excluded.last_seen_at,
             last_run_id = excluded.last_run_id,
             last_keywords = excluded.last_keywords`
        ).bind(
          domain,
          valueRatio,
          overallScore,
          estimatedValue,
          price,
          withinBudget ? 1 : 0,
          overBudget ? 1 : 0,
          completedAt,
          completedAt,
          runId,
          String(input.keywords || "")
        )
      );
    }
    if (domainBatch.length) await db.batch(domainBatch);

    const totalKeywords = Math.max(1, uniqueTokens.size);
    const coverageScore = clamp(uniqueTokens.size / Math.max(8, Number(input.loopCount || 1) * 2), 0, 1);
    const performanceScore = clamp(
      ((summary.withinBudgetCount / Math.max(1, summary.maxNames * Math.max(1, summary.loopCount))) * 0.45)
      + (clamp(summary.avgOverallTopWithin / 100, 0, 1) * 0.35)
      + (clamp(summary.underpricedCount / Math.max(1, summary.withinBudgetCount), 0, 1) * 0.20),
      0,
      1
    );
    const undervaluationScore = clamp((summary.avgUndervalueRatio - 1) / 9, 0, 1);
    const { policy: prevPolicy } = await loadPolicy(db);
    const nextPolicy = adaptPolicy(prevPolicy, {
      coverageScore,
      performanceScore,
      undervaluationScore,
      totalKeywords,
    });
    const policyUpdatedAt = await savePolicy(db, nextPolicy);

    return json({
      ok: true,
      enabled: true,
      runId,
      summary,
      rewardPolicy: compactPolicyForClient(nextPolicy),
      rewardPolicyMeta: {
        runCount: nextPolicy.runCount,
        movingCoverage: nextPolicy.movingCoverage,
        movingPerformance: nextPolicy.movingPerformance,
        movingUndervaluation: nextPolicy.movingUndervaluation,
        updatedAt: policyUpdatedAt,
      },
    }, 200);
  } catch (err) {
    return json({
      ok: false,
      enabled: true,
      message: "Failed to ingest run data.",
      error: err && err.message ? err.message : String(err || "unknown"),
    }, 500);
  }
}
