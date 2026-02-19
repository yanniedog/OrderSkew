// Domain Name Wizard - Optimizer (Thompson Sampling + UCB1 + Elite Replay)
// Depends on: worker-utils.js, worker-scoring.js

// ---------------------------------------------------------------------------
// Reward (multi-objective)
// ---------------------------------------------------------------------------

function scoreReward(rows, eliteSet, context) {
  const ctx = context || {};
  const withinBudgetRows = Array.isArray(ctx.withinBudgetRows) ? ctx.withinBudgetRows : (rows || []);
  const availableRows = Array.isArray(ctx.availableRows) ? ctx.availableRows : withinBudgetRows;
  const consideredCount = Math.max(1, Number(ctx.consideredCount) || availableRows.length || withinBudgetRows.length || 1);
  const requiredQuota = Math.max(1, Number(ctx.requiredQuota) || Math.max(1, withinBudgetRows.length));

  const averageTopScore01 = function (arr) {
    if (!arr || !arr.length) return 0;
    const top = arr
      .map((x) => Number(x.overallScore) || 0)
      .sort((a, b) => b - a)
      .slice(0, 5);
    if (!top.length) return 0;
    return clamp((top.reduce((s, v) => s + v, 0) / top.length) / 100, 0, 1);
  };
  const undervaluation01 = function (arr) {
    if (!arr || !arr.length) return 0;
    const ratios = arr
      .map((x) => Number(x.valueRatio) || 0)
      .filter((v) => v > 0)
      .sort((a, b) => b - a)
      .slice(0, 5);
    if (!ratios.length) return 0;
    const avg = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    return clamp((avg - 1) / 9, 0, 1);
  };

  const availableCount = availableRows.length;
  const withinBudgetCount = withinBudgetRows.length;
  const quotaCompletion = clamp(withinBudgetCount / requiredQuota, 0, 1);
  const availabilityRate = clamp(availableCount / consideredCount, 0, 1);
  const inBudgetRate = availableCount > 0 ? clamp(withinBudgetCount / availableCount, 0, 1) : 0;
  const topWithin = averageTopScore01(withinBudgetRows);
  const topAvailable = averageTopScore01(availableRows);
  const undervWithin = undervaluation01(withinBudgetRows);
  const undervAvailable = undervaluation01(availableRows);
  const underpricedShare = withinBudgetRows.length
    ? withinBudgetRows.filter((r) => Boolean(r.underpricedFlag)).length / withinBudgetRows.length
    : 0;
  const novelty = eliteSet
    ? availableRows.filter((r) => !eliteSet.has(String(r.domain || '').toLowerCase())).length / Math.max(1, availableRows.length)
    : 0.5;
  const sylSet = new Set(availableRows.map((r) => r.syllableCount || 0));
  const diversity = availableRows.length ? sylSet.size / Math.min(5, availableRows.length) : 0;
  const testedKeywords = dedupeTokens((ctx.selectedKeywords || []).map(normalizeThemeToken).filter(Boolean));
  const tokenPlaysMap = (ctx.tokenPlaysMap && typeof ctx.tokenPlaysMap === 'object') ? ctx.tokenPlaysMap : {};
  const lowTestRate = testedKeywords.length
    ? testedKeywords.filter((t) => (Number((tokenPlaysMap[t] && tokenPlaysMap[t].plays) || 0) <= 2)).length / testedKeywords.length
    : 0;
  const virginRate = testedKeywords.length
    ? testedKeywords.filter((t) => (Number((tokenPlaysMap[t] && tokenPlaysMap[t].plays) || 0) === 0)).length / testedKeywords.length
    : 0;
  const explorationKeywordBonus = clamp(lowTestRate * 0.7 + virginRate * 0.3, 0, 1);
  const reuseRate = testedKeywords.length
    ? testedKeywords.filter((t) => (Number((tokenPlaysMap[t] && tokenPlaysMap[t].plays) || 0) > 0)).length / testedKeywords.length
    : 0;
  const policy = (ctx.rewardPolicy && typeof ctx.rewardPolicy === 'object') ? ctx.rewardPolicy : {};
  const perfVsExplore = clamp(Number(policy.performanceVsExploration) || 0.78, 0.55, 0.95);
  const quotaWeight = clamp(Number(policy.quotaWeight) || 0.22, 0.10, 0.35);
  const undervalueWeight = clamp(Number(policy.undervalueWeight) || 0.24, 0.10, 0.40);
  const qualityWeight = clamp(Number(policy.qualityWeight) || 0.24, 0.10, 0.40);
  const availabilityWeight = clamp(Number(policy.availabilityWeight) || 0.18, 0.08, 0.35);
  const inBudgetWeight = clamp(Number(policy.inBudgetWeight) || 0.12, 0.05, 0.30);
  const perfWeightSum = Math.max(1e-6, quotaWeight + undervalueWeight + qualityWeight + availabilityWeight + inBudgetWeight);
  const perfComposite = clamp(
    (
      quotaCompletion * quotaWeight
      + (((undervWithin * 0.7) + (underpricedShare * 0.3)) * undervalueWeight)
      + (((topWithin * 0.8) + (topAvailable * 0.2)) * qualityWeight)
      + (availabilityRate * availabilityWeight)
      + (inBudgetRate * inBudgetWeight)
    ) / perfWeightSum,
    0,
    1,
  );
  const exploreComposite = clamp(
    explorationKeywordBonus * 0.55
    + novelty * 0.20
    + diversity * 0.15
    + virginRate * 0.10,
    0,
    1,
  );
  const curatedCoverage01 = clamp(Number(ctx.curatedCoverage01) || 0, 0, 1);
  const coverageDelta01 = clamp(Number(ctx.curatedCoverageDelta01) || 0, -1, 1);
  const coverageBoost = clamp(curatedCoverage01 * 0.75 + Math.max(0, coverageDelta01) * 0.25, 0, 1);
  const exploreCompositeWithCoverage = clamp(exploreComposite * 0.78 + coverageBoost * 0.22, 0, 1);
  let reward = clamp(
    perfComposite * perfVsExplore + exploreCompositeWithCoverage * (1 - perfVsExplore),
    0,
    1,
  );
  const reusePenaltyFactor = 0.25;
  reward = clamp(reward * (1 - reusePenaltyFactor * reuseRate), 0, 1);

  return round(reward, 4);
}

// ---------------------------------------------------------------------------
// Token validation - ensures only real words are used as keywords
// ---------------------------------------------------------------------------

function isValidToken(token) {
  if (!token || token.length < 2) return false;
  if (!WORD_FREQ || WORD_FREQ.size === 0) return true;
  if (WORD_FREQ.has(token)) return true;
  const seg = segmentWords(token);
  return seg.quality >= 0.7;
}

// ---------------------------------------------------------------------------
// Thompson Sampling helpers
// ---------------------------------------------------------------------------

function normalSample(rand) {
  const u1 = Math.max(1e-10, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gammaSample(shape, rand) {
  if (shape < 1) {
    return gammaSample(shape + 1, rand) * Math.pow(Math.max(1e-10, rand()), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let iter = 0; iter < 200; iter++) {
    let x, v;
    do {
      x = normalSample(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(Math.max(1e-10, u)) < 0.5 * x * x + d * (1 - v + Math.log(Math.max(1e-10, v)))) return d * v;
  }
  return shape;
}

function betaSample(alpha, beta, rand) {
  const x = gammaSample(Math.max(0.01, alpha), rand);
  const y = gammaSample(Math.max(0.01, beta), rand);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

function dedupeTokens(tokens) {
  const out = [];
  for (const token of tokens || []) {
    if (!token || out.includes(token)) continue;
    out.push(token);
  }
  return out;
}

function normalizeThemeToken(token) {
  const clean = String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean.length < 2 || clean.length > 24) return '';
  return clean;
}

function tokenStem(token) {
  let t = normalizeThemeToken(token);
  if (!t) return '';
  if (t.endsWith('ies') && t.length > 4) t = `${t.slice(0, -3)}y`;
  else if (t.endsWith('ing') && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith('ers') && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith('ed') && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith('es') && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith('s') && t.length > 3) t = t.slice(0, -1);
  return t;
}

function editDistanceWithin(a, b, maxDist) {
  const aa = normalizeThemeToken(a);
  const bb = normalizeThemeToken(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  if (Math.abs(aa.length - bb.length) > maxDist) return false;

  const prev = new Array(bb.length + 1);
  for (let j = 0; j <= bb.length; j += 1) prev[j] = j;

  for (let i = 1; i <= aa.length; i += 1) {
    const curr = [i];
    let rowMin = curr[0];
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      const v = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return false;
    for (let j = 0; j <= bb.length; j += 1) prev[j] = curr[j];
  }

  return prev[bb.length] <= maxDist;
}

function scoreThemeAffinity(token, seeds, seedStemSet) {
  const clean = normalizeThemeToken(token);
  if (!clean) return 0;
  let best = 0;
  const stem = tokenStem(clean);
  if (seedStemSet && seedStemSet.has(stem)) best = Math.max(best, 2.0);

  for (const seed of seeds || []) {
    if (!seed) continue;
    if (clean === seed) return 3.0;
    if (clean.length >= 4 && seed.length >= 4 && clean.slice(0, 3) === seed.slice(0, 3)) best = Math.max(best, 1.8);
    if (clean.length >= 4 && seed.length >= 4 && (clean.includes(seed) || seed.includes(clean))) best = Math.max(best, 2.2);
    if (clean.length >= 4 && seed.length >= 4 && editDistanceWithin(clean, seed, 2)) best = Math.max(best, 1.6);
  }

  return best;
}

function buildTokenVariants(token) {
  const clean = normalizeThemeToken(token);
  if (!clean) return [];
  const out = new Set([clean]);
  const stem = tokenStem(clean);
  if (stem) out.add(stem);

  if (clean.endsWith('y') && clean.length > 3) out.add(`${clean.slice(0, -1)}ies`);
  if (clean.endsWith('ies') && clean.length > 4) out.add(`${clean.slice(0, -3)}y`);
  if (clean.endsWith('s') && clean.length > 3) out.add(clean.slice(0, -1));
  else out.add(`${clean}s`);
  if (clean.length > 4 && !clean.endsWith('ing')) out.add(`${clean}ing`);
  if (clean.endsWith('ing') && clean.length > 5) out.add(clean.slice(0, -3));

  const replacePairs = [
    [/ph/g, 'f'],
    [/f/g, 'ph'],
    [/c/g, 'k'],
    [/k/g, 'c'],
    [/x/g, 'ks'],
    [/ks/g, 'x'],
    [/i/g, 'y'],
    [/y/g, 'i'],
  ];
  for (const [pat, rep] of replacePairs) {
    if (!pat.test(clean)) continue;
    out.add(clean.replace(pat, rep));
  }

  if (/([a-z0-9])\1/.test(clean)) out.add(clean.replace(/([a-z0-9])\1+/g, '$1'));
  return Array.from(out).map(normalizeThemeToken).filter(Boolean);
}

function isMirroredThemeToken(a, b) {
  const aa = normalizeThemeToken(a);
  const bb = normalizeThemeToken(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const as = tokenStem(aa);
  const bs = tokenStem(bb);
  if (as && bs && as.length >= 3 && as === bs) return true;
  if (aa.length >= 4 && bb.length >= 4 && (aa.includes(bb) || bb.includes(aa)) && Math.abs(aa.length - bb.length) <= 3) return true;
  if (aa.length >= 4 && bb.length >= 4 && editDistanceWithin(aa, bb, 1)) return true;
  return false;
}

function pickDistinctToken(pool, rand, selected) {
  const picks = Array.isArray(pool) ? pool : [];
  if (!picks.length) return '';
  const existing = Array.isArray(selected) ? selected : [];
  for (let i = 0; i < 12; i += 1) {
    const token = pick(picks, rand);
    const clean = normalizeThemeToken(token);
    if (!clean) continue;
    let conflict = false;
    for (const prior of existing) {
      if (isMirroredThemeToken(clean, prior)) {
        conflict = true;
        break;
      }
    }
    if (!conflict) return clean;
  }
  return normalizeThemeToken(pick(picks, rand));
}

const REVERSE_BUSINESS_SYNONYMS = (() => {
  const out = Object.create(null);
  for (const [root, syns] of Object.entries(BUSINESS_SYNONYMS || {})) {
    const rootToken = normalizeThemeToken(root);
    if (!rootToken) continue;
    for (const syn of syns || []) {
      const token = normalizeThemeToken(syn);
      if (!token) continue;
      if (!out[token]) out[token] = [];
      if (!out[token].includes(rootToken)) out[token].push(rootToken);
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Optimizer (Thompson Sampling + UCB1 + Elite Replay + Feature Learning)
// ---------------------------------------------------------------------------

const REPETITION_PENALTY_PARAMS = {
  gentle: { baseMult: 0.06, expBase: 1.6, cap: 0.4 },
  moderate: { baseMult: 0.15, expBase: 2.0, cap: 0.7 },
  strong: { baseMult: 0.52, expBase: 2.6, cap: 0.97 },
  very_severe: { baseMult: 0.75, expBase: 2.9, cap: 0.99 },
  extremely_severe: { baseMult: 0.92, expBase: 3.2, cap: 0.998 },
  excessive: { baseMult: 1.15, expBase: 3.5, cap: 0.999 },
};

class Optimizer {
  constructor(base, model, seed) {
    this.base = { ...base };
    this._repetitionPenaltyLevel = (base.rewardPolicy && base.rewardPolicy.repetitionPenaltyLevel) || 'strong';
    if (!REPETITION_PENALTY_PARAMS[this._repetitionPenaltyLevel]) this._repetitionPenaltyLevel = 'strong';
    this.model = sanitizeModel(model);
    this.rand = rng(seed || now());
    this.bestLoop = undefined;
    this.bestReward = -1;
    this.eliteSet = new Set(this.model.elitePool.map((e) => e.domain.toLowerCase()));
    this.totalPlays = Object.values(this.model.tokens).reduce((s, t) => s + t.plays, 0) || 1;

    this._baseKeywordTokens = tokenize(base.keywords).map(normalizeThemeToken).filter(Boolean).slice(0, 12);
    this._baseDescriptionTokens = tokenize(base.description || '').map(normalizeThemeToken).filter(Boolean).slice(0, 12);
    this._libraryTokens = Array.isArray(base.keywordLibraryTokens)
      ? base.keywordLibraryTokens.map(normalizeThemeToken).filter(Boolean).slice(0, 120)
      : [];
    this._libraryPhraseTokens = Array.isArray(base.keywordLibraryPhrases)
      ? tokenize(base.keywordLibraryPhrases.join(' ')).map(normalizeThemeToken).filter(Boolean).slice(0, 80)
      : [];
    this._curatedHasLibrary = this._libraryTokens.length > 0 || this._libraryPhraseTokens.length > 0;
    this._themeSeedTokens = dedupeTokens(
      this._libraryTokens.concat(this._libraryPhraseTokens, this._baseKeywordTokens, this._baseDescriptionTokens),
    )
      .map(function (t) { return normalizeThemeToken(t); })
      .filter(Boolean)
      .slice(0, 40);
    if (!this._themeSeedTokens.length) this._themeSeedTokens = ['brand'];
    this._baseTokenSet = new Set(this._themeSeedTokens);
    this._themeSeedStems = new Set(this._themeSeedTokens.map(tokenStem).filter(Boolean));
    this._baseKeywordTokenSet = new Set(this._baseKeywordTokens);
    this._libraryTokenSet = new Set(this._libraryTokens);
    this._libraryPhraseTokenSet = new Set(this._libraryPhraseTokens);
    this._lockedSeedTokens = [];
    this._recentKeywordSignatures = [];
    this._recentKeywordSets = [];
    this._recentHistoryMax = 18;
    this._coverageCursor = 0;
    this._minAssessmentsPerSearch = 2;
    this._keywordsPerLoop = 10;
    this._keywordsPerLoopMin = 8;
    this._keywordsPerLoopMax = 12;
    this._runExposure = new Map();

    this._themeTokenScores = this._buildThemeTokenScores();
    this._themeTokenSet = new Set(this._themeTokenScores.keys());
    this._themeTokenPool = Array.from(this._themeTokenScores.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([token]) => token);
    if (!this._themeTokenPool.length && this._themeSeedTokens.length) {
      this._themeTokenPool = this._themeSeedTokens.slice(0, 160);
      this._themeTokenSet = new Set(this._themeTokenPool);
    }
    const totalLoops = Math.max(1, Number(this.base.loopCount) || 30);
    const assessableCap = Math.max(this._keywordsPerLoopMax, Math.floor((totalLoops * this._keywordsPerLoop) / this._minAssessmentsPerSearch));
    this._assessmentPool = this._themeTokenPool.slice(0, assessableCap);
    for (const token of this._assessmentPool) this._runExposure.set(token, 0);

    this.curTokens = this._seedCurrentTokens();
    this._recordRunExposure(this.curTokens);
    this._rememberKeywordSet(this.curTokens);
    emitDebugLog('worker-optimizer.js', 'Initialized strict keyword pool', {
      seedTokens: this._themeSeedTokens.slice(0, 12),
      lockedTokens: this._lockedSeedTokens.slice(),
      curatedLibraryTokens: this._libraryTokens.slice(0, 20),
      curatedLibraryPhrases: (base.keywordLibraryPhrases || []).slice(0, 8),
      poolSize: this._themeTokenPool.length,
      assessmentPoolSize: this._assessmentPool.length,
      poolTokens: this._themeTokenPool.slice(0, 40),
    });

    const toDelete = [];
    for (const [token] of Object.entries(this.model.tokens)) {
      if (!this._isThemeToken(token)) toDelete.push(token);
    }
    if (toDelete.length > 0) {
      emitDebugLog('worker-optimizer.js', 'Pruned off-theme tokens from persisted model', {
        prunedCount: toDelete.length,
        prunedSample: toDelete.slice(0, 20),
        remainingCount: Object.keys(this.model.tokens).length - toDelete.length,
      });
      for (const t of toDelete) delete this.model.tokens[t];
    }

    this.model.elitePool = [];
  }

  _keywordSignature(tokens) {
    const normalized = dedupeTokens((tokens || []).map(normalizeThemeToken).filter(Boolean))
      .sort((a, b) => a.localeCompare(b));
    return normalized.join('|');
  }

  _rememberKeywordSet(tokens) {
    const clean = dedupeTokens((tokens || []).map(normalizeThemeToken).filter(Boolean)).slice(0, this._keywordsPerLoop);
    if (!clean.length) return;
    const sig = this._keywordSignature(clean);
    const prevIdx = this._recentKeywordSignatures.indexOf(sig);
    if (prevIdx >= 0) {
      this._recentKeywordSignatures.splice(prevIdx, 1);
      this._recentKeywordSets.splice(prevIdx, 1);
    }
    this._recentKeywordSignatures.push(sig);
    this._recentKeywordSets.push(clean);
    while (this._recentKeywordSignatures.length > this._recentHistoryMax) {
      this._recentKeywordSignatures.shift();
      this._recentKeywordSets.shift();
    }
  }

  _recordRunExposure(tokens) {
    for (const token of dedupeTokens((tokens || []).map(normalizeThemeToken).filter(Boolean))) {
      const prev = Number(this._runExposure.get(token) || 0);
      this._runExposure.set(token, prev + 1);
    }
  }

  _assessmentDeficit(token) {
    const seen = Number(this._runExposure.get(token) || 0);
    return Math.max(0, this._minAssessmentsPerSearch - seen);
  }

  _remainingAssessmentNeed() {
    let need = 0;
    for (const token of this._assessmentPool || []) need += this._assessmentDeficit(token);
    return need;
  }

  getCoverageMetrics() {
    const pool = this._assessmentPool || [];
    const total = pool.length;
    let assessedOnce = 0;
    let assessedTarget = 0;
    let exposureProgress = 0;
    for (const token of pool) {
      const seen = Number(this._runExposure.get(token) || 0);
      if (seen >= 1) assessedOnce += 1;
      if (seen >= this._minAssessmentsPerSearch) assessedTarget += 1;
      exposureProgress += Math.min(this._minAssessmentsPerSearch, Math.max(0, seen));
    }
    const targetExposures = total > 0 ? total * this._minAssessmentsPerSearch : 0;
    const coverageProgress01 = targetExposures > 0 ? clamp(exposureProgress / targetExposures, 0, 1) : 0;
    const coverageTarget01 = total > 0 ? clamp(assessedTarget / total, 0, 1) : 0;
    return {
      total,
      assessedOnce,
      assessedTarget,
      targetPerKeyword: this._minAssessmentsPerSearch,
      // Progressive coverage used for UI/reward so it updates every loop.
      coverage01: coverageProgress01,
      coveragePct: round(coverageProgress01 * 100, 1),
      coverageTarget01,
      coverageTargetPct: round(coverageTarget01 * 100, 1),
      needRemaining: this._remainingAssessmentNeed(),
    };
  }

  _assessmentQuota(loop, lockedSet) {
    const totalLoops = Math.max(1, Number(this.base.loopCount) || 30);
    const loopsRemaining = Math.max(1, totalLoops - Math.max(1, Number(loop) || 1) + 1);
    const remainingNeed = this._remainingAssessmentNeed();
    const lockedCount = lockedSet ? lockedSet.size : 0;
    const freeSlots = Math.max(0, this._keywordsPerLoop - lockedCount);
    if (remainingNeed <= 0 || freeSlots <= 0) return 0;
    return clamp(Math.ceil(remainingNeed / loopsRemaining), 0, freeSlots);
  }

  _targetKeywordsForLoop(loop, explorationRate, explorationBurst) {
    const totalLoops = Math.max(1, Number(this.base.loopCount) || 100);
    const progress = totalLoops <= 1 ? 1 : clamp((Number(loop) - 1) / (totalLoops - 1), 0, 1);
    // Gradually taper from broader exploration to tighter exploitation.
    let target = this._keywordsPerLoopMax - (this._keywordsPerLoopMax - this._keywordsPerLoopMin) * progress;
    if (Number(explorationRate) >= 0.30) target += 0.7;
    else if (Number(explorationRate) >= 0.24) target += 0.3;
    if (explorationBurst) target += 0.8;
    return Math.max(this._keywordsPerLoopMin, Math.min(this._keywordsPerLoopMax, Math.round(target)));
  }

  _tokenSimilarity(a, b) {
    const aa = normalizeThemeToken(a);
    const bb = normalizeThemeToken(b);
    if (!aa || !bb) return 0;
    if (aa === bb) return 1;
    if (isMirroredThemeToken(aa, bb)) return 0.95;
    const as = tokenStem(aa);
    const bs = tokenStem(bb);
    if (as && bs && as === bs) return 0.9;
    if (aa.length >= 4 && bb.length >= 4 && aa.slice(0, 3) === bb.slice(0, 3)) return 0.6;
    return 0;
  }

  _countOverlap(a, b) {
    const aa = new Set((a || []).map(normalizeThemeToken).filter(Boolean));
    const bb = new Set((b || []).map(normalizeThemeToken).filter(Boolean));
    let shared = 0;
    for (const t of aa) if (bb.has(t)) shared += 1;
    return shared;
  }

  _noveltyPool(candidates, loop) {
    return dedupeTokens(candidates || [])
      .map((token) => normalizeThemeToken(token))
      .filter((token) => token && this._isThemeToken(token))
      .map((token) => {
        const stat = this.model.tokens[token] || {};
        const plays = Math.max(0, Number(stat.plays) || 0);
        const lastLoop = stat.lastLoop == null ? -1 : Number(stat.lastLoop);
        const age = lastLoop >= 0 ? Math.max(0, Number(loop || 1) - lastLoop) : 999;
        const freshness = clamp(age / 12, 0, 1);
        const rarity = 1 / Math.sqrt(1 + plays);
        const theme = clamp(Number(this._themeTokenScores.get(token) || 0) / 5, 0, 1);
        let score = rarity * 0.60 + freshness * 0.25 + theme * 0.15;
        const consecutiveLoops = Math.max(0, Number(stat.consecutiveLoops) || 0);
        score *= 1 - this._repetitionPenalty(consecutiveLoops);
        return { token, score };
      })
      .sort((a, b) => b.score - a.score || a.token.localeCompare(b.token))
      .map((x) => x.token);
  }

  _coveragePool(loop) {
    const l = Math.max(1, Number(loop) || 1);
    return dedupeTokens(this._themeTokenPool.slice(0, 180))
      .map((token) => normalizeThemeToken(token))
      .filter((token) => token && this._isThemeToken(token))
      .map((token) => {
        const stat = this.model.tokens[token] || {};
        const plays = Math.max(0, Number(stat.plays) || 0);
        const lastLoop = stat.lastLoop == null ? -1 : Number(stat.lastLoop);
        const recencyGap = lastLoop >= 0 ? Math.max(0, l - lastLoop) : 999;
        const theme = clamp(Number(this._themeTokenScores.get(token) || 0) / 5, 0, 1);
        let score = (plays === 0 ? 1.0 : 0.0) * 0.55
          + clamp(1 / Math.sqrt(1 + plays), 0, 1) * 0.25
          + clamp(recencyGap / 14, 0, 1) * 0.10
          + theme * 0.10;
        const consecutiveLoops = Math.max(0, Number(stat.consecutiveLoops) || 0);
        score *= 1 - this._repetitionPenalty(consecutiveLoops);
        return { token, score, plays };
      })
      .sort((a, b) => b.score - a.score || a.plays - b.plays || a.token.localeCompare(b.token));
  }

  _injectCoverage(next, options) {
    const opts = options || {};
    const loop = Number(opts.loop) || 1;
    const minInject = Math.max(0, Number(opts.minInject) || 0);
    if (minInject <= 0) return;
    const lockedSet = opts.lockedSet instanceof Set ? opts.lockedSet : new Set();
    const coverage = this._coveragePool(loop).map((x) => x.token);
    if (!coverage.length) return;

    let injected = 0;
    let cursor = this._coverageCursor % coverage.length;
    for (let step = 0; step < coverage.length && injected < minInject; step += 1) {
      const candidate = coverage[cursor];
      cursor = (cursor + 1) % coverage.length;
      if (!candidate || next.includes(candidate) || lockedSet.has(candidate)) continue;
      let idx = next.findIndex((t) => !lockedSet.has(t) && !this._baseKeywordTokenSet.has(t));
      if (idx < 0) idx = next.findIndex((t) => !lockedSet.has(t));
      if (idx < 0) break;
      if (next.some((prior, pidx) => pidx !== idx && isMirroredThemeToken(candidate, prior))) continue;
      next[idx] = candidate;
      injected += 1;
    }
    this._coverageCursor = cursor;
  }

  _enforceAssessmentCoverage(next, options) {
    const opts = options || {};
    const loop = Number(opts.loop) || 1;
    const lockedSet = opts.lockedSet instanceof Set ? opts.lockedSet : new Set();
    const quota = Math.max(0, Number(opts.quota) || 0);
    if (quota <= 0) return 0;

    const deficits = (this._assessmentPool || [])
      .map((token) => {
        const d = this._assessmentDeficit(token);
        const stat = this.model.tokens[token] || {};
        const plays = Math.max(0, Number(stat.plays) || 0);
        const lastLoop = stat.lastLoop == null ? -1 : Number(stat.lastLoop);
        const age = lastLoop >= 0 ? Math.max(0, loop - lastLoop) : 999;
        const themeScore = Number(this._themeTokenScores.get(token) || 0);
        return { token, deficit: d, plays, age, themeScore };
      })
      .filter((x) => x.deficit > 0)
      .sort((a, b) => b.deficit - a.deficit || a.plays - b.plays || b.age - a.age || b.themeScore - a.themeScore || a.token.localeCompare(b.token));

    let injected = 0;
    for (const item of deficits) {
      if (injected >= quota) break;
      const token = item.token;
      if (!token || next.includes(token) || lockedSet.has(token)) continue;
      let replaceIdx = next.findIndex((t) => !lockedSet.has(t) && this._assessmentDeficit(t) <= 0);
      if (replaceIdx < 0) replaceIdx = next.findIndex((t) => !lockedSet.has(t));
      if (replaceIdx < 0) break;
      if (next.some((prior, idx) => idx !== replaceIdx && this._tokenSimilarity(token, prior) >= 0.9)) continue;
      next[replaceIdx] = token;
      injected += 1;
    }
    return injected;
  }

  _enforceDiversity(next, candidatePool, lockedSet) {
    const locked = lockedSet instanceof Set ? lockedSet : new Set();
    const pool = dedupeTokens(candidatePool || []).map(normalizeThemeToken).filter((t) => t && this._isThemeToken(t));
    for (let i = 0; i < next.length; i += 1) {
      for (let j = i + 1; j < next.length; j += 1) {
        if (this._tokenSimilarity(next[i], next[j]) < 0.9) continue;
        if (locked.has(next[j])) continue;
        let replacement = '';
        for (const cand of pool) {
          if (!cand || next.includes(cand) || locked.has(cand)) continue;
          let tooSimilar = false;
          for (let k = 0; k < next.length; k += 1) {
            if (k === j) continue;
            if (this._tokenSimilarity(cand, next[k]) >= 0.9) {
              tooSimilar = true;
              break;
            }
          }
          if (!tooSimilar) {
            replacement = cand;
            break;
          }
        }
        if (replacement) next[j] = replacement;
      }
    }
  }

  _injectNovelty(next, options) {
    const opts = options || {};
    const loop = Number(opts.loop) || 1;
    const targetOverlap = Math.max(2, Math.min(6, Number(opts.targetOverlap) || 4));
    const prevTokens = Array.isArray(opts.prevTokens) ? opts.prevTokens : [];
    const lockedSet = opts.lockedSet instanceof Set ? opts.lockedSet : new Set();
    const fallbackPool = Array.isArray(opts.fallbackPool) ? opts.fallbackPool : [];
    const novelPool = this._noveltyPool(
      dedupeTokens((opts.candidatePool || []).concat(fallbackPool, this._themeTokenPool.slice(0, 120))),
      loop,
    );

    let passes = 0;
    while (passes < 5) {
      passes += 1;
      const overlap = this._countOverlap(next, prevTokens);
      const sig = this._keywordSignature(next);
      const recentDup = this._recentKeywordSignatures.includes(sig);
      if (overlap <= targetOverlap && !recentDup) break;

      const replaceCount = recentDup ? 3 : Math.max(1, overlap - targetOverlap);
      for (let i = 0; i < replaceCount; i += 1) {
        const replaceIdx = next.findIndex((token) => !lockedSet.has(token));
        if (replaceIdx < 0) break;
        let replacement = '';
        for (const cand of novelPool) {
          if (!cand || next.includes(cand) || lockedSet.has(cand)) continue;
          if (next.some((prior, idx) => idx !== replaceIdx && isMirroredThemeToken(cand, prior))) continue;
          replacement = cand;
          break;
        }
        if (!replacement) {
          replacement = pickDistinctToken(fallbackPool, this.rand, next) || pickDistinctToken(this._themeTokenPool, this.rand, next);
        }
        if (!replacement) break;
        next[replaceIdx] = replacement;
      }
      this._dedupeMirroredTokens(next, lockedSet);
      this._refillThemeTokens(next, novelPool.concat(fallbackPool, this._themeTokenPool));
      if (next.length > this._keywordsPerLoop) next.length = this._keywordsPerLoop;
    }
  }

  thompsonChoose(map, keys) {
    let best = keys[0];
    let bestSample = -Infinity;
    for (const key of keys) {
      const s = map[key] || { plays: 0, reward: 0 };
      const alpha = 1 + s.reward;
      const beta = 1 + Math.max(0, s.plays - s.reward);
      const sample = betaSample(alpha, beta, this.rand);
      if (sample > bestSample || (sample === bestSample && this.rand() > 0.5)) {
        best = key;
        bestSample = sample;
      }
    }
    return best;
  }

  ucbScore(stat) {
    if (!stat || !stat.plays) return Infinity;
    const avg = stat.reward / stat.plays;
    return avg + Math.sqrt(2 * Math.log(this.totalPlays) / stat.plays);
  }

  _wilsonLowerBound(successes, trials, z) {
    const n = Math.max(0, Number(trials) || 0);
    if (n <= 0) return 0;
    const s = Math.max(0, Math.min(n, Number(successes) || 0));
    const zz = Number(z) || 1.96;
    const p = s / n;
    const denom = 1 + (zz * zz) / n;
    const center = p + (zz * zz) / (2 * n);
    const margin = zz * Math.sqrt((p * (1 - p) + (zz * zz) / (4 * n)) / n);
    return clamp((center - margin) / denom, 0, 1);
  }

  _tokenPerformance(stat) {
    const s = stat || {};
    const plays = Math.max(0, Math.floor(Number(s.plays) || 0));
    const reward = Number(s.reward) || 0;
    const avgReward = plays > 0 ? reward / plays : 0;
    const winCount = Math.max(0, Number(s.winCount) || 0);
    const successRate = plays > 0 ? clamp(winCount / plays, 0, 1) : 0;
    const domainMatches = Math.max(0, Number(s.domainMatches) || 0);
    const domainScoreSum = Number(s.domainScoreSum) || 0;
    const meanDomainScoreNorm = domainMatches > 0 ? clamp((domainScoreSum / domainMatches) / 100, 0, 1) : 0;
    const confidence = clamp(Math.log10(plays + 1) / 2, 0, 1);
    const wilson = this._wilsonLowerBound(winCount, plays, 1.96);
    const score = clamp(
      avgReward * 0.40
        + meanDomainScoreNorm * 0.25
        + wilson * 0.20
        + confidence * 0.15,
      0,
      1,
    );
    return {
      plays,
      reward,
      avgReward,
      winCount,
      successRate,
      domainMatches,
      meanDomainScoreNorm,
      meanDomainScore: meanDomainScoreNorm * 100,
      confidence,
      wilson,
      score,
    };
  }

  _repetitionPenalty(consecutiveLoops) {
    if (!consecutiveLoops || consecutiveLoops <= 0) return 0;
    const params = REPETITION_PENALTY_PARAMS[this._repetitionPenaltyLevel] || REPETITION_PENALTY_PARAMS.strong;
    return clamp(params.baseMult * Math.pow(params.expBase, Math.min(consecutiveLoops, 6)), 0, params.cap);
  }

  getRepetitionPenaltyForTokens(tokens) {
    const list = Array.isArray(tokens) ? tokens : tokenize(String(tokens || '')).map(normalizeThemeToken).filter(Boolean);
    if (!list.length) return 0;
    let sum = 0;
    for (const token of list) {
      const clean = normalizeThemeToken(token);
      if (!clean) continue;
      const stat = this.model.tokens[clean] || {};
      const consecutiveLoops = Math.max(0, Number(stat.consecutiveLoops) || 0);
      sum += this._repetitionPenalty(consecutiveLoops);
    }
    return list.length ? sum / list.length : 0;
  }

  _tokenSelectionScore(stat, perf, explorationRate) {
    const s = stat || {};
    const p = perf || this._tokenPerformance(s);
    const plays = Math.max(0, Number(s.plays) || 0);
    const explorationBonus = explorationRate * (plays > 0 ? clamp(1 / Math.sqrt(plays), 0, 1) : 1);
    const exploitation = p.score * (1 - explorationRate * 0.65);
    const token = s && s._token ? normalizeThemeToken(s._token) : '';
    const detail = token && DEV_ECOSYSTEM_DETAIL_CACHE && DEV_ECOSYSTEM_DETAIL_CACHE.get(token);
    const githubRepos = detail && Number.isFinite(detail.githubRepos) ? Number(detail.githubRepos) : 0;
    const githubPrior = githubRepos > 0 ? clamp(Math.log10(1 + githubRepos) / 10, 0, 0.18) : 0;
    const raw = clamp(exploitation + explorationBonus * 0.22 + githubPrior, 0, 1.6);
    const consecutiveLoops = Math.max(0, Math.floor(Number(s.consecutiveLoops) || 0));
    const repPenalty = this._repetitionPenalty(consecutiveLoops);
    return clamp(raw * (1 - repPenalty), 0, 1.6);
  }

  _isThemeToken(token) {
    const clean = normalizeThemeToken(token);
    if (!clean) return false;
    return this._baseTokenSet.has(clean) || this._themeTokenSet.has(clean);
  }

  _addThemeToken(scored, token, weight) {
    const clean = normalizeThemeToken(token);
    if (!clean) return;
    const prev = scored.get(clean) || 0;
    if (weight > prev) scored.set(clean, weight);
  }

  _buildThemeTokenScores() {
    const scored = new Map();
    const baseTokenWeight = this._curatedHasLibrary ? 3.8 : 5.0;
    const variantWeight = this._curatedHasLibrary ? 3.0 : 3.0;
    const directSynWeight = this._curatedHasLibrary ? 3.1 : 3.6;
    const reverseRootWeight = this._curatedHasLibrary ? 3.0 : 3.4;
    const siblingWeight = this._curatedHasLibrary ? 2.9 : 2.8;

    for (const seed of this._themeSeedTokens) {
      this._addThemeToken(scored, seed, baseTokenWeight);
      for (const variant of buildTokenVariants(seed)) this._addThemeToken(scored, variant, variantWeight);

      const directSynonyms = BUSINESS_SYNONYMS[seed] || [];
      for (const syn of directSynonyms) {
        this._addThemeToken(scored, syn, directSynWeight);
        for (const variant of buildTokenVariants(syn)) this._addThemeToken(scored, variant, 2.4);
      }

      const reverseRoots = REVERSE_BUSINESS_SYNONYMS[seed] || [];
      for (const root of reverseRoots) {
        this._addThemeToken(scored, root, reverseRootWeight);
        for (const sibling of BUSINESS_SYNONYMS[root] || []) this._addThemeToken(scored, sibling, siblingWeight);
      }
    }

    return new Map(
      Array.from(scored.entries())
        .filter(([token, score]) => this._baseTokenSet.has(token) || score >= 2.4)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 160),
    );
  }

  _seedCurrentTokens() {
    const next = [];
    const add = (token) => {
      const clean = normalizeThemeToken(token);
      if (!clean || next.includes(clean) || !this._isThemeToken(clean)) return;
      next.push(clean);
    };

    for (const token of this._lockedSeedTokens) add(token);
    for (const token of tokenize(`${this.base.keywords} ${this.base.description}`)) add(token);
    for (const token of this._themeTokenPool) {
      if (next.length >= this._keywordsPerLoop) break;
      add(token);
    }

    return next.slice(0, this._keywordsPerLoop);
  }

  _collectEliteThemeTokens() {
    const out = [];
    for (const elite of this.model.elitePool.slice(0, 12)) {
      const label = String(elite.domain || '').split('.')[0] || '';
      for (const m of findMorphemes(label)) {
        const clean = normalizeThemeToken(m);
        if (!clean || out.includes(clean)) continue;
        if (this._themeTokenSet.has(clean) || this._baseTokenSet.has(clean)) out.push(clean);
      }
    }
    return out.slice(0, 24);
  }

  _ensureLockedTokens(next, locked) {
    const lockedSet = new Set(locked);
    for (const token of locked) {
      if (next.includes(token)) continue;
      if (next.length < this._keywordsPerLoop) {
        next.push(token);
        continue;
      }
      const replaceIdx = next.findIndex((t) => !lockedSet.has(t));
      if (replaceIdx >= 0) next[replaceIdx] = token;
    }
  }

  _removeOneMutable(next, weak, lockedSet) {
    if (next.length <= Math.max(2, lockedSet.size + 1)) return;
    let idx = next.findIndex((t) => !lockedSet.has(t) && weak.has(t));
    if (idx < 0) {
      const mutableIdx = [];
      for (let i = 0; i < next.length; i += 1) if (!lockedSet.has(next[i])) mutableIdx.push(i);
      if (!mutableIdx.length) return;
      idx = mutableIdx[Math.floor(this.rand() * mutableIdx.length)];
    }
    next.splice(idx, 1);
  }

  _refillThemeTokens(next, refillPool) {
    for (const token of refillPool) {
      const clean = normalizeThemeToken(token);
      if (!clean || next.includes(clean) || !this._isThemeToken(clean)) continue;
      next.push(clean);
      if (next.length >= this._keywordsPerLoop) break;
    }
  }

  _mutateAndReorder(next, intensity, lockedSet) {
    if (!next.length) return;
    const mutableIdx = [];
    for (let i = 0; i < next.length; i += 1) if (!lockedSet.has(next[i])) mutableIdx.push(i);
    if (!mutableIdx.length) return;

    const replacements = intensity === 'high' ? 3 : intensity === 'medium' ? 2 : 1;
    const pool = this._noveltyPool(this._themeTokenPool.slice(0, 140), this.bestLoop || 1);
    for (let i = 0; i < replacements; i += 1) {
      const idx = mutableIdx[Math.floor(this.rand() * mutableIdx.length)];
      let replacement = '';
      for (const candidate of pool) {
        if (!candidate || next.includes(candidate)) continue;
        if (next.some((prior, pidx) => pidx !== idx && isMirroredThemeToken(candidate, prior))) continue;
        replacement = candidate;
        break;
      }
      if (!replacement) replacement = pickDistinctToken(this._themeTokenPool, this.rand, next);
      if (!replacement) continue;
      next[idx] = replacement;
    }
  }

  _dedupeMirroredTokens(next, lockedSet) {
    const out = [];
    const locked = lockedSet || new Set();
    for (const token of next) {
      const clean = normalizeThemeToken(token);
      if (!clean) continue;
      let replaceIdx = -1;
      for (let i = 0; i < out.length; i += 1) {
        if (!isMirroredThemeToken(clean, out[i])) continue;
        replaceIdx = i;
        break;
      }
      if (replaceIdx < 0) {
        out.push(clean);
        continue;
      }
      const prior = out[replaceIdx];
      if (locked.has(prior) && !locked.has(clean)) continue;
      if (locked.has(clean) && !locked.has(prior)) {
        out[replaceIdx] = clean;
        continue;
      }
      const scorePrior = Number(this._themeTokenScores.get(prior) || 0);
      const scoreNext = Number(this._themeTokenScores.get(clean) || 0);
      if (scoreNext > scorePrior) out[replaceIdx] = clean;
    }
    next.length = 0;
    for (const token of out.slice(0, this._keywordsPerLoop)) next.push(token);
  }

  _limitBaseSeedCarry(next, maxBaseTokens) {
    const limit = Math.max(0, Math.floor(Number(maxBaseTokens) || 0));
    if (limit >= next.length) return;

    const baseIdx = [];
    for (let i = 0; i < next.length; i += 1) {
      if (this._baseKeywordTokenSet.has(next[i])) baseIdx.push(i);
    }
    if (baseIdx.length <= limit) return;

    while (baseIdx.length > limit) {
      const idx = baseIdx.pop();
      if (idx == null || idx < 0 || idx >= next.length) continue;
      const replacement = this._themeTokenPool.find((token) => {
        const clean = normalizeThemeToken(token);
        return clean
          && !next.includes(clean)
          && !this._baseKeywordTokenSet.has(clean)
          && this._isThemeToken(clean);
      });
      if (replacement) next[idx] = normalizeThemeToken(replacement);
      else next.splice(idx, 1);
    }
  }

  getKeywordLibraryRows(limit) {
    const maxRows = Math.max(8, Math.min(200, Number(limit) || 80));
    const currentSet = new Set((this.curTokens || []).map(normalizeThemeToken).filter(Boolean));
    const candidates = dedupeTokens(
      this._themeTokenPool
        .concat(this._themeSeedTokens)
        .concat(this._baseKeywordTokens)
        .concat(this._libraryTokens),
    );

    const rows = [];
    for (const token of candidates) {
      const clean = normalizeThemeToken(token);
      if (!clean || !this._isThemeToken(clean)) continue;
      const stat = this.model.tokens[clean] || { plays: 0, reward: 0, lastLoop: null };
      const statForScore = { ...stat, _token: clean };
      const perf = this._tokenPerformance(stat);
      const ucb = this.ucbScore(stat);
      const selectionScore = this._tokenSelectionScore(statForScore, perf, 0.08);
      const devDetail = DEV_ECOSYSTEM_DETAIL_CACHE.get(clean) || null;
      const githubRepos = devDetail && Number.isFinite(devDetail.githubRepos) ? Number(devDetail.githubRepos) : null;
      const npmPackages = devDetail && Number.isFinite(devDetail.npmPackages) ? Number(devDetail.npmPackages) : null;
      const githubPrior = githubRepos && githubRepos > 0 ? clamp(Math.log10(1 + githubRepos) / 10, 0, 0.18) : 0;
      let source = 'theme';
      if (this._baseKeywordTokenSet.has(clean)) source = 'seed';
      else if (this._libraryTokenSet.has(clean)) source = 'synonym_api';
      else if (this._libraryPhraseTokenSet.has(clean)) source = 'synonym_phrase';
      rows.push({
        token: clean,
        source,
        isSeed: this._baseKeywordTokenSet.has(clean),
        inCurrentKeywords: currentSet.has(clean),
        themeScore: Number(this._themeTokenScores.get(clean) || 0),
        plays: perf.plays,
        reward: round(perf.reward, 4),
        avgReward: round(perf.avgReward, 4),
        successRate: round(perf.successRate, 4),
        confidence: round(perf.confidence, 4),
        wilson: round(perf.wilson, 4),
        meanDomainScore: round(perf.meanDomainScore, 2),
        performanceScore: round(perf.score * 100, 2),
        selectionScore: round(selectionScore * 100, 2),
        githubRepos,
        npmPackages,
        githubPrior: round(githubPrior * 100, 2),
        devEvidenceSource: devDetail && devDetail.source ? devDetail.source : null,
        ucb: Number.isFinite(ucb) ? round(ucb, 4) : null,
        lastLoop: stat.lastLoop != null ? Number(stat.lastLoop) : null,
      });
    }

    rows.sort((a, b) => {
      if (a.inCurrentKeywords !== b.inCurrentKeywords) return a.inCurrentKeywords ? -1 : 1;
      if ((a.selectionScore || 0) !== (b.selectionScore || 0)) return (b.selectionScore || 0) - (a.selectionScore || 0);
      if ((a.performanceScore || 0) !== (b.performanceScore || 0)) return (b.performanceScore || 0) - (a.performanceScore || 0);
      if (a.plays !== b.plays) return b.plays - a.plays;
      if (a.avgReward !== b.avgReward) return b.avgReward - a.avgReward;
      if ((a.themeScore || 0) !== (b.themeScore || 0)) return (b.themeScore || 0) - (a.themeScore || 0);
      return a.token.localeCompare(b.token);
    });
    for (let i = 0; i < rows.length; i += 1) rows[i].rank = i + 1;
    return rows.slice(0, maxRows);
  }

  next(loop) {
    const explorationRate = Math.max(0.18, 0.42 * Math.pow(0.88, loop - 1));
    const explorationBurst = loop <= 10 || (loop % 4 === 0);
    this._keywordsPerLoop = this._targetKeywordsForLoop(loop, explorationRate, explorationBurst);
    const styleOptions = this.base.preferEnglish !== false
      ? STYLE_VALUES.filter((value) => value !== 'nonenglish')
      : STYLE_VALUES;

    const style = this.rand() < explorationRate
      ? pick(styleOptions, this.rand)
      : this.thompsonChoose(this.model.style, styleOptions);
    const randomness = this.rand() < explorationRate
      ? pick(RANDOMNESS_VALUES, this.rand)
      : this.thompsonChoose(this.model.randomness, RANDOMNESS_VALUES);

    // Rank across the full theme pool so unseen tokens can be sampled and assessed.
    const tokenUniverse = dedupeTokens(
      this._themeTokenPool
        .concat(Object.keys(this.model.tokens || {}))
        .concat(this._themeSeedTokens),
    ).slice(0, 200);
    const tokenRank = tokenUniverse
      .filter((token) => this._isThemeToken(token))
      .map((token) => {
        const stat = this.model.tokens[token] || { plays: 0, reward: 0 };
        const perf = this._tokenPerformance(stat);
        const selectionScore = this._tokenSelectionScore({ ...stat, _token: token }, perf, explorationRate);
        return { token, ucb: this.ucbScore(stat), perf, selectionScore, plays: perf.plays };
      })
      .sort((a, b) => (b.selectionScore - a.selectionScore) || (b.ucb - a.ucb));

    const good = tokenRank
      .filter((x) => x.selectionScore >= 0.62)
      .map((x) => x.token)
      .slice(0, 30);

    const weak = new Set(
      tokenRank
        .filter((x) => x.selectionScore <= 0.38 && (this.model.tokens[x.token] || {}).plays >= 4)
        .map((x) => x.token),
    );

    const baseTokens = this._baseKeywordTokens.length ? this._baseKeywordTokens.slice(0, 12) : this._themeSeedTokens.slice(0, this._keywordsPerLoop);
    const anchorPool = this._themeTokenPool.slice(0, 60);
    const adaptivePool = dedupeTokens(tokenRank.slice(0, 40).map(function (x) { return x.token; }).concat(anchorPool));
    const eliteTokens = this._collectEliteThemeTokens();

    const intensity = explorationBurst || this.rand() < explorationRate
      ? 'high'
      : this.rand() > 0.25 ? 'medium' : 'low';
    const mut = intensity === 'high' ? 7 : intensity === 'medium' ? 5 : 3;
    const locked = this._lockedSeedTokens.slice();
    const lockedSet = new Set(locked);
    const prevTokens = (this.curTokens || []).slice();

    const next = [];
    for (const t of locked) if (!next.includes(t) && this._isThemeToken(t)) next.push(t);
    const carryBudget = explorationBurst
      ? 1
      : Math.max(0, Math.min(2, Math.floor(1 + (1 - explorationRate) * 1.5)));
    for (const t of this.curTokens) {
      const clean = normalizeThemeToken(t);
      if (!clean || next.includes(clean) || !this._isThemeToken(clean)) continue;
      if (next.some((prior) => isMirroredThemeToken(clean, prior))) continue;
      if (next.length >= carryBudget) break;
      next.push(clean);
      if (next.length >= this._keywordsPerLoop) break;
    }
    if (!next.length) this._refillThemeTokens(next, baseTokens.concat(anchorPool));

    for (let i = 0; i < mut; i += 1) {
      this._removeOneMutable(next, weak, lockedSet);
      let src;
      const r = this.rand();
      if (good.length && r < 0.30 + (1 - explorationRate) * 0.35) src = good;
      else if (adaptivePool.length && r < 0.90) src = adaptivePool;
      else if (eliteTokens.length && r < 0.96) src = eliteTokens;
      else src = baseTokens;
      const t = pick((src && src.length) ? src : baseTokens, this.rand);
      const clean = normalizeThemeToken(t);
      if (clean && next.some((prior) => isMirroredThemeToken(clean, prior))) continue;
      if (clean && !next.includes(clean) && this._isThemeToken(clean)) next.push(clean);
    }

    this._ensureLockedTokens(next, locked);
    this._refillThemeTokens(
      next,
      dedupeTokens(good.concat(adaptivePool, eliteTokens, baseTokens, this._themeSeedTokens)),
    );
    this._mutateAndReorder(next, intensity, lockedSet);
    this._dedupeMirroredTokens(next, lockedSet);
    this._limitBaseSeedCarry(next, 1);
    this._refillThemeTokens(next, dedupeTokens(adaptivePool.concat(good, eliteTokens, this._themeSeedTokens)));
    this._dedupeMirroredTokens(next, lockedSet);
    this._limitBaseSeedCarry(next, 1);

    this._injectNovelty(next, {
      loop,
      prevTokens,
      targetOverlap: explorationBurst ? 2 : (explorationRate >= 0.24 ? 3 : 4),
      lockedSet,
      candidatePool: dedupeTokens(adaptivePool.concat(good, eliteTokens, baseTokens)),
      fallbackPool: dedupeTokens(this._themeTokenPool.concat(baseTokens)),
    });
    // Coverage quota: force a few low/never-played tokens into each loop plan.
    const coverageQuota = explorationBurst
      ? 4
      : explorationRate >= 0.30 ? 3 : explorationRate >= 0.20 ? 2 : 1;
    this._injectCoverage(next, { loop, minInject: coverageQuota, lockedSet });
    const requiredAssessQuota = this._assessmentQuota(loop, lockedSet);
    const forcedAssessments = this._enforceAssessmentCoverage(next, { loop, lockedSet, quota: requiredAssessQuota });
    this._enforceDiversity(next, dedupeTokens(adaptivePool.concat(good, eliteTokens, this._assessmentPool, this._themeTokenPool)), lockedSet);

    this.curTokens = dedupeTokens(next.map(normalizeThemeToken).filter((t) => t && this._isThemeToken(t))).slice(0, this._keywordsPerLoop);
    if (!this.curTokens.length) this.curTokens = baseTokens.slice(0, Math.min(this._keywordsPerLoop, baseTokens.length));
    this._recordRunExposure(this.curTokens);
    this._rememberKeywordSet(this.curTokens);

    emitDebugLog('worker-optimizer.js', 'Loop keyword selection', {
      loop,
      previousKeywords: prevTokens.slice(0, this._keywordsPerLoop),
      selectedKeywords: this.curTokens.slice(),
      overlapWithPrevious: this._countOverlap(prevTokens, this.curTokens),
      signature: this._keywordSignature(this.curTokens),
      recentSignatureCount: this._recentKeywordSignatures.length,
      explorationBurst,
      keywordsPerLoop: this._keywordsPerLoop,
      carryBudget,
      mutationPasses: mut,
      coverageQuota,
      requiredAssessQuota,
      forcedAssessments,
      assessmentNeedRemaining: this._remainingAssessmentNeed(),
      assessedAtLeastTwice: (this._assessmentPool || []).filter((t) => (this._runExposure.get(t) || 0) >= this._minAssessmentsPerSearch).length,
      unplayedInSelection: this.curTokens.filter((t) => !this.model.tokens[t] || !this.model.tokens[t].plays).length,
      poolSize: this._themeTokenPool.length,
    });

    const repetitionPenaltyApplied = this.getRepetitionPenaltyForTokens(this.curTokens);
    return {
      loop,
      sourceLoop: this.bestLoop,
      explorationRate: round(explorationRate, 3),
      selectedStyle: style,
      selectedRandomness: randomness,
      selectedMutationIntensity: intensity,
      elitePoolSize: this.model.elitePool.length,
      repetitionPenaltyApplied: round(repetitionPenaltyApplied, 4),
      input: {
        ...this.base,
        style,
        randomness,
        keywords: this.curTokens.join(' ') || this.base.keywords,
      },
    };
  }

  record(plan, reward, loopDomains) {
    const r = clamp(Number(reward) || 0, 0, 1);
    this.model.style[plan.selectedStyle].plays += 1;
    this.model.style[plan.selectedStyle].reward += r;
    this.model.randomness[plan.selectedRandomness].plays += 1;
    this.model.randomness[plan.selectedRandomness].reward += r;

    let tokens = tokenize(`${plan.input.keywords} ${plan.input.description}`)
      .map(normalizeThemeToken)
      .filter((t) => t && this._isThemeToken(t))
      .slice(0, 12);
    if (tokens.length === 0) tokens = this._lockedSeedTokens.slice(0, 3);

    const tokenSet = new Set(tokens);
    const loopDomainsArr = Array.isArray(loopDomains) ? loopDomains : [];
    const domainStatsByStem = new Map();
    for (const dom of loopDomainsArr) {
      if (!dom || !dom.domain) continue;
      const label = String(dom.domain || '').split('.')[0] || '';
      const score = Number(dom.overallScore) || 0;
      const stems = new Set(findMorphemes(label).map(tokenStem).filter(Boolean));
      for (const stem of stems) {
        const prev = domainStatsByStem.get(stem) || { matches: 0, scoreSum: 0 };
        prev.matches += 1;
        prev.scoreSum += score;
        domainStatsByStem.set(stem, prev);
      }
    }

    for (const token of tokenSet) {
      if (!this.model.tokens[token]) {
        this.model.tokens[token] = {
          plays: 0, reward: 0, lastLoop: null, consecutiveLoops: 0,
          winCount: 0, lossCount: 0,
          domainMatches: 0, domainScoreSum: 0,
        };
      }
      const prevLastLoop = this.model.tokens[token].lastLoop;
      const wasUsedLastLoop = prevLastLoop != null && Number(prevLastLoop) === Number(plan.loop) - 1;
      this.model.tokens[token].consecutiveLoops = wasUsedLastLoop
        ? Math.max(1, (Number(this.model.tokens[token].consecutiveLoops) || 0) + 1)
        : 1;
      this.model.tokens[token].plays += 1;
      this.model.tokens[token].reward += r;
      this.model.tokens[token].lastLoop = plan.loop;
      if (r >= 0.55) this.model.tokens[token].winCount += 1;
      else this.model.tokens[token].lossCount += 1;
      const stem = tokenStem(token);
      const domainStats = stem ? domainStatsByStem.get(stem) : null;
      if (domainStats) {
        this.model.tokens[token].domainMatches += domainStats.matches;
        this.model.tokens[token].domainScoreSum += domainStats.scoreSum;
      }
    }
    this.totalPlays = Object.values(this.model.tokens).reduce((s, t) => s + t.plays, 0) || 1;

    if (Array.isArray(loopDomains)) {
      for (const dom of loopDomains) {
        if (!dom || !dom.domain) continue;
        const label = dom.domain.split('.')[0] || '';
        const len = label.replace(/-/g, '').length;
        const lenBucket = len <= 6 ? 'short' : len <= 10 ? 'medium' : 'long';
        const sylBucket = String(Math.min(estimateSyllables(label), 4) === 4 ? '4plus' : estimateSyllables(label));
        const morphs = findMorphemes(label);
        const score01 = (dom.overallScore || 0) / 100;

        this.model.featureStats.lengthBuckets[lenBucket].plays += 1;
        this.model.featureStats.lengthBuckets[lenBucket].reward += score01;
        if (this.model.featureStats.syllableBuckets[sylBucket]) {
          this.model.featureStats.syllableBuckets[sylBucket].plays += 1;
          this.model.featureStats.syllableBuckets[sylBucket].reward += score01;
        }
        if (morphs.length > 0) {
          this.model.featureStats.hasRealWord.plays += 1;
          this.model.featureStats.hasRealWord.reward += score01;
        } else {
          this.model.featureStats.noRealWord.plays += 1;
          this.model.featureStats.noRealWord.reward += score01;
        }

        const existing = this.model.elitePool.find((e) => e.domain.toLowerCase() === dom.domain.toLowerCase());
        if (existing) {
          if ((dom.overallScore || 0) > existing.score) existing.score = dom.overallScore || 0;
        } else {
          this.model.elitePool.push({ domain: dom.domain, score: dom.overallScore || 0 });
        }
      }
      this.model.elitePool.sort((a, b) => b.score - a.score);
      this.model.elitePool = this.model.elitePool.slice(0, 30);
      this.eliteSet = new Set(this.model.elitePool.map((e) => e.domain.toLowerCase()));
    }

    if (r >= this.bestReward) {
      this.bestReward = r;
      this.bestLoop = plan.loop;
    }

    return {
      loop: plan.loop,
      sourceLoop: plan.sourceLoop,
      keywords: plan.input.keywords,
      description: plan.input.description || '',
      selectedStyle: plan.selectedStyle,
      selectedRandomness: plan.selectedRandomness,
      selectedMutationIntensity: plan.selectedMutationIntensity,
      explorationRate: plan.explorationRate,
      elitePoolSize: this.model.elitePool.length,
      reward: round(r, 4),
      repetitionPenaltyApplied: plan.repetitionPenaltyApplied != null ? round(Number(plan.repetitionPenaltyApplied), 4) : null,
    };
  }

  snapshot() {
    this.model.tokens = Object.fromEntries(
      Object.entries(this.model.tokens)
        .filter(([token]) => this._isThemeToken(token))
        .sort((a, b) => (this.ucbScore(b[1]) - this.ucbScore(a[1])))
        .slice(0, 300),
    );
    this.model.runCount += 1;
    this.model.updatedAt = now();
    return this.model;
  }
}

// ---------------------------------------------------------------------------
// Name generation (local fallback)
// ---------------------------------------------------------------------------

function styleName(style, a, b, c, rand) {
  if (style === 'twowords') return `${a}${b}`;
  if (style === 'threewords') return `${a}${b}${c}`;
  if (style === 'compound') return `${a}${pick(SUFFIX, rand)}`;
  if (style === 'brandable') return `${a.slice(0, Math.ceil(a.length / 2))}${b.slice(Math.floor(b.length / 2))}`;
  if (style === 'spelling') {
    let out = `${a}${b}`;
    out = out.replace(/ph/g, 'f').replace(/c/g, 'k').replace(/x/g, 'ks');
    if (out.length > 3 && rand() > 0.6) out = `${out.slice(0, -1)}${pick(['i', 'y', 'o'], rand)}`;
    return out;
  }
  if (style === 'nonenglish') return `${a.slice(0, Math.ceil(a.length / 2))}${b.slice(Math.floor(b.length / 2))}${pick(['a', 'o', 'i', 'u'], rand)}`;
  if (style === 'dictionary') return `${pick(DICT, rand)}${a}`;
  return `${pick(PREFIX, rand)}${a}${pick(SUFFIX, rand)}`;
}

function looksEnglishLikeLabel(label) {
  const clean = String(label || '').toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length < 3) return false;
  const tri = trigramScore(clean);
  const seg = segmentWords(clean);
  if (seg.quality >= 0.32) return true;
  return tri >= -2.45;
}

function makeBatch(plan, seed, target, seen) {
  const rand = rng(seed >>> 0);
  const preferEnglish = plan.preferEnglish !== false;
  const style = preferEnglish && plan.style === 'nonenglish' ? 'default' : plan.style;
  const tokens = tokenize(`${plan.keywords} ${plan.description}`).map((t) => t.replace(/[^a-z0-9]/g, '')).filter((t) => t.length >= 2);
  const pool = tokens.length ? tokens : ['nova', 'orbit', 'lumen', 'quant', 'forge', 'signal'];
  const blocked = new Set(text(plan.blacklist).split(',').map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean));
  const out = [];
  let tries = 0;
  while (out.length < target && tries < target * 20) {
    tries += 1;
    const chosen = [];
    const a = pickDistinctToken(pool, rand, chosen);
    if (a) chosen.push(a);
    const b = pickDistinctToken(pool, rand, chosen);
    if (b) chosen.push(b);
    const c = pickDistinctToken(pool, rand, chosen);
    if (c) chosen.push(c);
    if (!a || !b || isMirroredThemeToken(a, b) || isMirroredThemeToken(a, c) || isMirroredThemeToken(b, c)) continue;
    let sourceName = styleName(style, a, b, c, rand);
    if (plan.randomness === 'high' && rand() > 0.45) sourceName += pick(SUFFIX, rand);
    if (plan.randomness === 'low' && sourceName.length > 16) sourceName = sourceName.slice(0, 16);
    const label = toLabel(sourceName);
    if (!label || label.length > plan.maxLength) continue;
    const compact = label.replace(/-/g, '');
    if (/^([a-z0-9]{2,10})\1$/.test(compact)) continue;
    if (/([a-z]{3,})\1/.test(compact)) continue;
    const morphs = findMorphemes(compact).map(tokenStem).filter(Boolean);
    if (morphs.length >= 2 && (new Set(morphs)).size <= 1) continue;
    if (preferEnglish && !looksEnglishLikeLabel(label)) continue;
    let isBlocked = false;
    for (const tok of blocked) if (tok && label.includes(tok)) { isBlocked = true; break; }
    if (isBlocked) continue;
    const domain = `${label}.${plan.tld}`;
    const key = domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = { domain, sourceName, premiumPricing: false };
    out.push(candidate);
  }
  return out;
}

function progress(totalLoops, currentLoop, fraction) {
  if (totalLoops <= 0) return 100;
  const norm = (Math.max(0, currentLoop - 1) + clamp(fraction, 0, 1)) / totalLoops;
  return Math.round(5 + norm * 90);
}
