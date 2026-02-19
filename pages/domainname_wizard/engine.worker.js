// Domain Name Wizard - Web Worker Entry Point
// Loads modules and orchestrates the main run loop

const jobs = new Map();
const canceled = new Set();
let dbPromise = null;
const WORKER_ASSET_VERSION = '2026-02-19-5';

importScripts(
  `worker-utils.js?v=${WORKER_ASSET_VERSION}`,
  `worker-scoring.js?v=${WORKER_ASSET_VERSION}`,
  `worker-optimizer.js?v=${WORKER_ASSET_VERSION}`,
  `worker-api.js?v=${WORKER_ASSET_VERSION}`,
);

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function defaultModel() {
  return {
    runCount: 0,
    updatedAt: now(),
    style: Object.fromEntries(STYLE_VALUES.map((k) => [k, { plays: 0, reward: 0 }])),
    randomness: Object.fromEntries(RANDOMNESS_VALUES.map((k) => [k, { plays: 0, reward: 0 }])),
    tokens: {},
    elitePool: [],
    featureStats: {
      lengthBuckets: { short: { plays: 0, reward: 0 }, medium: { plays: 0, reward: 0 }, long: { plays: 0, reward: 0 } },
      syllableBuckets: { '1': { plays: 0, reward: 0 }, '2': { plays: 0, reward: 0 }, '3': { plays: 0, reward: 0 }, '4plus': { plays: 0, reward: 0 } },
      hasRealWord: { plays: 0, reward: 0 },
      noRealWord: { plays: 0, reward: 0 },
    },
  };
}

function sanitizeModel(source) {
  const d = defaultModel();
  if (!source || typeof source !== 'object') return d;
  for (const k of STYLE_VALUES) if (source.style && source.style[k]) d.style[k] = { plays: Math.max(0, Math.floor(Number(source.style[k].plays) || 0)), reward: Number(source.style[k].reward) || 0 };
  for (const k of RANDOMNESS_VALUES) if (source.randomness && source.randomness[k]) d.randomness[k] = { plays: Math.max(0, Math.floor(Number(source.randomness[k].plays) || 0)), reward: Number(source.randomness[k].reward) || 0 };
  if (source.tokens && typeof source.tokens === 'object') {
    for (const [k, v] of Object.entries(source.tokens)) {
      if (!k || k.length > 32) continue;
      d.tokens[k] = {
        plays: Math.max(0, Math.floor(Number(v.plays) || 0)),
        reward: Number(v.reward) || 0,
        lastLoop: v && v.lastLoop != null ? Math.max(0, Math.floor(Number(v.lastLoop) || 0)) : null,
        winCount: Math.max(0, Math.floor(Number(v.winCount) || 0)),
        lossCount: Math.max(0, Math.floor(Number(v.lossCount) || 0)),
        domainMatches: Math.max(0, Math.floor(Number(v.domainMatches) || 0)),
        domainScoreSum: Number(v.domainScoreSum) || 0,
      };
    }
  }
  if (Array.isArray(source.elitePool)) {
    d.elitePool = source.elitePool.filter(e => e && e.domain && typeof e.score === 'number').slice(0, 30);
  }
  if (source.featureStats && typeof source.featureStats === 'object') {
    const fs = source.featureStats;
    for (const bk of ['short', 'medium', 'long']) {
      if (fs.lengthBuckets && fs.lengthBuckets[bk]) d.featureStats.lengthBuckets[bk] = { plays: Number(fs.lengthBuckets[bk].plays) || 0, reward: Number(fs.lengthBuckets[bk].reward) || 0 };
    }
    for (const bk of ['1', '2', '3', '4plus']) {
      if (fs.syllableBuckets && fs.syllableBuckets[bk]) d.featureStats.syllableBuckets[bk] = { plays: Number(fs.syllableBuckets[bk].plays) || 0, reward: Number(fs.syllableBuckets[bk].reward) || 0 };
    }
    if (fs.hasRealWord) d.featureStats.hasRealWord = { plays: Number(fs.hasRealWord.plays) || 0, reward: Number(fs.hasRealWord.reward) || 0 };
    if (fs.noRealWord) d.featureStats.noRealWord = { plays: Number(fs.noRealWord.plays) || 0, reward: Number(fs.noRealWord.reward) || 0 };
  }
  d.runCount = Number(source.runCount) || 0;
  d.updatedAt = Number(source.updatedAt) || now();
  return d;
}

async function loadModel() {
  const db = await openDb();
  if (!db) return defaultModel();
  try {
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(MODEL_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    return sanitizeModel(row && row.value);
  } catch {
    return defaultModel();
  }
}

async function saveModel(model) {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key: MODEL_KEY, value: sanitizeModel(model) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore persistence failures
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pending, keywordState) {
  const allRanked = sortRanked(Array.from(availableMap.values()), 'marketability');
  const withinBudgetOnly = allRanked.filter(function (r) { return r.overBudget !== true; });
  let keywordLibrary = null;
  if (keywordState && keywordState.optimizer && typeof keywordState.optimizer.getKeywordLibraryRows === 'function') {
    const lib = keywordState.library || {};
    keywordLibrary = {
      seedTokens: Array.isArray(lib.seedTokens) ? lib.seedTokens.slice(0, 16) : [],
      currentKeywords: Array.isArray(keywordState.optimizer.curTokens) ? keywordState.optimizer.curTokens.slice(0, 8) : [],
      tokens: keywordState.optimizer.getKeywordLibraryRows(120),
      apiStatus: lib.apiStatus || null,
      devEcosystemStatus: keywordState.devEcosystemStatus || null,
    };
  } else if (keywordState && keywordState.library) {
    const lib = keywordState.library || {};
    const fallbackTokens = Array.isArray(lib.tokens) ? lib.tokens.slice(0, 120) : [];
    keywordLibrary = {
      seedTokens: Array.isArray(lib.seedTokens) ? lib.seedTokens.slice(0, 16) : [],
      currentKeywords: [],
      tokens: fallbackTokens.map(function (token, idx) {
        return {
          rank: idx + 1,
          token: String(token || ''),
          source: 'library',
          isSeed: Array.isArray(lib.seedTokens) ? lib.seedTokens.includes(token) : false,
          inCurrentKeywords: false,
          themeScore: 0,
          plays: 0,
          reward: 0,
          avgReward: 0,
          successRate: 0,
          confidence: 0,
          wilson: 0,
          meanDomainScore: 0,
          performanceScore: 0,
          selectionScore: 0,
          githubRepos: null,
          npmPackages: null,
          githubPrior: 0,
          devEvidenceSource: null,
          ucb: null,
          lastLoop: null,
        };
      }),
      apiStatus: lib.apiStatus || null,
      devEcosystemStatus: keywordState.devEcosystemStatus || null,
    };
  }
  return {
    withinBudget: withinBudgetOnly.slice().sort(sortByPrice),
    overBudget: sortRanked(Array.from(overBudgetMap.values()), 'financialValue'),
    unavailable: sortRanked(Array.from(unavailableMap.values()), 'marketability'),
    allRanked,
    loopSummaries: loopSummaries.slice(),
    tuningHistory: tuningHistory.slice(),
    pending: Array.isArray(pending) ? pending : [],
    keywordLibrary,
  };
}

// ---------------------------------------------------------------------------
// Main run loop
// ---------------------------------------------------------------------------

async function run(job) {
  await loadValuationData();
  const input = job.input;
  const backendBaseUrl = String(input.apiBaseUrl || '').trim();
  let useBackend = Boolean(backendBaseUrl);
  emitDebugLog('engine.worker.js:run', useBackend ? 'Using backend availability API' : 'Using RDAP availability API', {
    backendBaseUrl: useBackend ? backendBaseUrl : null,
    loopCount: input.loopCount,
    maxNames: input.maxNames,
  });
  const availableMap = new Map();
  const overBudgetMap = new Map();
  const unavailableMap = new Map();
  const loopSummaries = [];
  const tuningHistory = [];

  let keywordLibrary = {
    seedTokens: tokenize(`${input.keywords} ${input.description || ''}`).slice(0, 8),
    tokens: tokenize(`${input.keywords} ${input.description || ''}`).slice(0, 24),
    phrases: [],
    keywordString: input.keywords,
  };
  try {
    keywordLibrary = await fetchAssociatedKeywordLibrary(`${input.keywords} ${input.description || ''}`, {
      preferEnglish: input.preferEnglish !== false,
      maxSeeds: 8,
    });
    emitDebugLog('engine.worker.js:run', 'Keyword library enriched via APIs', {
      seedCount: keywordLibrary.seedTokens.length,
      tokenCount: keywordLibrary.tokens.length,
      phraseCount: keywordLibrary.phrases.length,
      preferEnglish: input.preferEnglish !== false,
      sampleTokens: keywordLibrary.tokens.slice(0, 16),
      samplePhrases: keywordLibrary.phrases.slice(0, 8),
    });
  } catch (libraryErr) {
    emitDebugLog('engine.worker.js:run', 'Keyword library API enrichment failed; using normalized seed tokens', {
      error: libraryErr && libraryErr.message ? libraryErr.message : String(libraryErr || 'unknown'),
    });
  }

  const model = await loadModel();
  const optimizerInput = {
    ...input,
    keywordLibraryTokens: keywordLibrary.tokens.slice(0, 120),
    keywordLibraryPhrases: keywordLibrary.phrases.slice(0, 60),
  };
  const optimizer = new Optimizer(optimizerInput, model, hash(job.id));
  const keywordState = { optimizer, library: keywordLibrary };
  let prevCoverage01 = optimizer.getCoverageMetrics ? (optimizer.getCoverageMetrics().coverage01 || 0) : 0;
  const makeSnapshot = function (pending) {
    return snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pending, keywordState);
  };

  patch(job, { status: 'running', phase: 'looping', progress: 5, currentLoop: 0, totalLoops: input.loopCount, results: makeSnapshot([]) });

  for (let loop = 1; loop <= input.loopCount; loop += 1) {
    if (canceled.has(job.id)) throw new Error('Run canceled by user.');

    const plan = optimizer.next(loop);
    const seen = new Set();
    const loopAvail = [];
    const loopOverBudget = [];
    const loopAllDomains = [];

    let considered = 0;
    let batches = 0;
    let limitHit = false;
    let stalls = 0;
    let skipReason;
    const nameSources = new Set();
    const seenLabels = new Set();
    const prevNamesBase = Array.from(availableMap.keys())
      .concat(Array.from(overBudgetMap.keys()), Array.from(unavailableMap.keys()))
      .map(function (k) { return k.split('.')[0]; });
    for (const label of prevNamesBase) if (label) seenLabels.add(label.toLowerCase());

    while (loopAvail.length < plan.input.maxNames && batches < MAX_BATCH && stalls < MAX_STALL) {
      patch(job, { status: 'running', phase: 'namelix', progress: progress(input.loopCount, loop, 0.03), currentLoop: loop, totalLoops: input.loopCount });

      const prevNames = Array.from(new Set(prevNamesBase.concat(Array.from(seenLabels)))).slice(0, 320);
      let cands = [];
      let nameSourceBatch = 'unknown';

      if (backendBaseUrl) {
        try {
          const namelixNames = await fetchNamelixNames(backendBaseUrl, plan.input, prevNames);
          cands = namelixNames.map(function (n) {
            const key = String(n.domain || '').toLowerCase();
            const label = key.split('.')[0] || '';
            if (!key || seen.has(key)) return null;
            if (label && seenLabels.has(label)) return null;
            seen.add(key);
            if (label) seenLabels.add(label);
            return { domain: n.domain, sourceName: n.sourceName || n.businessName, premiumPricing: false };
          }).filter(Boolean);
          nameSourceBatch = 'Namelix API (namelix.com)';
          nameSources.add(nameSourceBatch);
          sendIngest('engine.worker.js:run', 'Name generation source', {
            source: nameSourceBatch, namelixApiCalled: true, syntheticNameGeneration: false,
            candidateCount: cands.length,
            sampleCandidates: cands.slice(0, 3).map(function(c) { return { domain: c.domain, sourceName: c.sourceName }; }),
          }, 'H3');
        } catch (namelixErr) {
          const namelixErrMsg = namelixErr instanceof Error ? namelixErr.message : String(namelixErr || 'unknown');
          sendIngest('engine.worker.js:run', 'Namelix API failed, falling back to local generation', { error: namelixErrMsg }, 'H3');
          emitDebugLog('engine.worker.js:run', 'Namelix API failed, using local fallback', { error: namelixErrMsg });
        }
      }

      if (cands.length === 0) {
        const seed = hash(`${job.id}|${loop}|${batches}|${seen.size}`);
        const batchMax = clamp(Math.floor(Math.max(plan.input.maxNames * 3, plan.input.maxNames, 80)), plan.input.maxNames, 250);
        cands = makeBatch(plan.input, seed, batchMax, seen)
          .filter(function (n) {
            const key = String(n.domain || '').toLowerCase();
            const label = key.split('.')[0] || '';
            if (!key) return false;
            if (label && seenLabels.has(label)) return false;
            if (label) seenLabels.add(label);
            return true;
          });
        nameSourceBatch = 'LOCAL (makeBatch fallback)';
        nameSources.add(nameSourceBatch);
        sendIngest('engine.worker.js:run', 'Name generation source', {
          source: nameSourceBatch, namelixApiCalled: false, syntheticNameGeneration: true,
          candidateCount: cands.length,
          sampleCandidates: cands.slice(0, 3).map(function(c) { return { domain: c.domain, premiumPricing: c.premiumPricing }; }),
        }, 'H3');
      }

      if (!cands.length) {
        stalls += 1;
        skipReason = 'No new candidates generated';
        continue;
      }

      considered += cands.length;
      batches += 1;
      const pendingRows = cands.map(function (c) { return { domain: c.domain, sourceName: c.sourceName, premiumPricing: c.premiumPricing }; });
      patch(job, { status: 'running', phase: 'godaddy', progress: progress(input.loopCount, loop, 0.1 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))), currentLoop: loop, totalLoops: input.loopCount, results: makeSnapshot(pendingRows) });

      let gotWithinBudget = 0;
      let gotAvailableAny = 0;
      const domainList = cands.map(function (c) { return c.domain; });
      let availabilityByDomain;
      if (useBackend) {
        sendIngest('engine.worker.js:run', 'About to call primary availability API', { url: backendBaseUrl + '/api/domains/availability', domainCount: domainList.length }, 'H5');
        try {
          availabilityByDomain = await fetchAvailability(backendBaseUrl, domainList);
          if (availabilityByDomain._debug) {
            sendIngest('engine.worker.js:run', 'GoDaddy backend _debug metadata', { _debug: availabilityByDomain._debug }, 'H1');
            self.postMessage({ type: 'debugLog', payload: { sessionId: 'efbcb6', location: 'engine.worker.js:run', message: 'GoDaddy API debug info', data: availabilityByDomain._debug, timestamp: Date.now() } });
          }
          delete availabilityByDomain._debug;
        } catch (error) {
          const primaryError = error instanceof Error ? error.message : String(error || 'unknown');
          sendIngest('engine.worker.js:run', 'Primary availability failed, falling back to RDAP', { primaryError, backendBaseUrl }, 'H4');
          useBackend = false;
          patch(job, { phase: 'rdap' });
          availabilityByDomain = await fetchRdapAvailability(domainList, job.id, function (done, total) {
            const frac = total > 0 ? done / total : 0;
            patch(job, { phase: 'rdap', progress: progress(input.loopCount, loop, 0.1 + 0.5 * frac) });
          });
          emitDebugLog('engine.worker.js:run', 'Backend unavailable, switched to RDAP (no prices available)', { backendBaseUrl, error: primaryError });
        }
      } else {
        patch(job, { phase: 'rdap' });
        availabilityByDomain = await fetchRdapAvailability(domainList, job.id, function (done, total) {
          const frac = total > 0 ? done / total : 0;
          patch(job, { phase: 'rdap', progress: progress(input.loopCount, loop, 0.1 + 0.5 * frac) });
        });
      }

      for (const cand of cands) {
        let result;
        const key = cand.domain.toLowerCase();
        const res = availabilityByDomain[key] || {};
        if (useBackend && (typeof res.price === 'number' && Number.isFinite(res.price))) {
          const price = round(res.price, 2);
          const premiumPricing = price > plan.input.yearlyBudget || price > 500;
          result = {
            domain: cand.domain,
            sourceName: cand.sourceName,
            premiumPricing,
            available: Boolean(res.available),
            definitive: Boolean(res.definitive),
            price,
            currency: res.currency || 'USD',
            period: res.period != null ? res.period : 1,
            reason: res.reason || (res.available ? 'Available (GoDaddy).' : 'Unavailable (GoDaddy).'),
            overBudget: res.available ? price > plan.input.yearlyBudget : false,
          };
        } else if (res && typeof res.available === 'boolean') {
          const price = useBackend && typeof res.price === 'number' && Number.isFinite(res.price) ? round(res.price, 2) : undefined;
          const premiumPricing = typeof price === 'number' && (price > plan.input.yearlyBudget || price > 500);
          result = {
            domain: cand.domain,
            sourceName: cand.sourceName,
            premiumPricing: price != null ? premiumPricing : false,
            available: res.available,
            definitive: Boolean(res.definitive),
            price,
            currency: res.currency || 'USD',
            period: res.period != null ? res.period : 1,
            reason: res.reason || (res.available ? 'Available.' : 'Unavailable.'),
            overBudget: res.available && typeof price === 'number' ? price > plan.input.yearlyBudget : false,
          };
        } else {
          result = {
            domain: cand.domain,
            sourceName: cand.sourceName,
            premiumPricing: false,
            available: false,
            definitive: false,
            price: undefined,
            currency: 'USD',
            period: 1,
            reason: 'No availability data (backend or RDAP).',
            overBudget: false,
          };
        }

        const ranked = { ...result, ...scoreDomain(result, plan.input), firstSeenLoop: loop, lastSeenLoop: loop, timesDiscovered: 1 };
        loopAllDomains.push(ranked);

        if (result.available && !result.overBudget) {
          gotWithinBudget += 1;
          gotAvailableAny += 1;
          loopAvail.push(ranked);
          overBudgetMap.delete(key);
          availableMap.set(key, mergeBest(availableMap.get(key), ranked, loop));
        } else if (result.available && result.overBudget) {
          gotAvailableAny += 1;
          loopOverBudget.push(ranked);
          availableMap.delete(key);
          overBudgetMap.set(key, mergeBest(overBudgetMap.get(key), ranked, loop));
        } else {
          unavailableMap.set(key, mergeBest(unavailableMap.get(key), ranked, loop));
        }

        const nextPending = (job.results && job.results.pending) ? job.results.pending.filter(function (p) { return String(p.domain || '').toLowerCase() !== key; }) : [];
        patch(job, { results: makeSnapshot(nextPending) });
      }

      if (gotWithinBudget > 0) stalls = 0;
      else stalls += 1;

      if (loopAvail.length >= plan.input.maxNames) {
        limitHit = true;
        break;
      }

      patch(job, {
        status: 'running',
        phase: 'looping',
        progress: progress(input.loopCount, loop, 0.2 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))),
        currentLoop: loop,
        totalLoops: input.loopCount,
        results: makeSnapshot([]),
      });
    }

    const nameSource = nameSources.size ? Array.from(nameSources).join(' + ') : 'unknown';
    if (!skipReason && loopAvail.length < plan.input.maxNames) {
      if (stalls >= MAX_STALL) skipReason = 'Stall limit reached before in-budget quota';
      else if (batches >= MAX_BATCH) skipReason = 'Batch limit reached before in-budget quota';
      else skipReason = 'In-budget quota not reached';
    }

    const rankedLoop = sortRanked(loopAvail, 'marketability');
    const rankedAvailableAll = sortRanked(loopAvail.concat(loopOverBudget), 'marketability');
    const coverage = optimizer.getCoverageMetrics ? optimizer.getCoverageMetrics() : { coverage01: 0, coveragePct: 0, total: 0, assessedTarget: 0, targetPerKeyword: 2, needRemaining: 0 };
    const reward = scoreReward(rankedLoop, optimizer.eliteSet, {
      withinBudgetRows: rankedLoop,
      availableRows: rankedAvailableAll,
      overBudgetRows: loopOverBudget,
      consideredCount: considered,
      requiredQuota: plan.input.maxNames,
      selectedKeywords: (optimizer.curTokens || []).slice(),
      tokenPlaysMap: optimizer.model && optimizer.model.tokens ? optimizer.model.tokens : {},
      rewardPolicy: (plan.input && plan.input.rewardPolicy) || input.rewardPolicy || null,
      curatedCoverage01: Number(coverage.coverage01 || 0),
      curatedCoverageDelta01: Number(coverage.coverage01 || 0) - Number(prevCoverage01 || 0),
    });
    prevCoverage01 = Number(coverage.coverage01 || 0);
    const step = optimizer.record(plan, reward, loopAllDomains);
    tuningHistory.push(step);

    const avg = rankedAvailableAll.length ? round(rankedAvailableAll.reduce((s, r) => s + (r.overallScore || 0), 0) / rankedAvailableAll.length, 2) : 0;
    const valueRatios = rankedLoop.map((r) => Number(r.valueRatio) || 0).filter((v) => v > 0);
    const avgValueRatio = valueRatios.length ? round(valueRatios.reduce((s, v) => s + v, 0) / valueRatios.length, 3) : 0;
    const underpricedCount = rankedLoop.filter((r) => Boolean(r.underpricedFlag)).length;
    const top = rankedAvailableAll[0];

    loopSummaries.push({
      loop,
      keywords: plan.input.keywords,
      description: plan.input.description || '',
      style: plan.selectedStyle,
      randomness: plan.selectedRandomness,
      mutationIntensity: plan.selectedMutationIntensity,
      explorationRate: plan.explorationRate,
      elitePoolSize: plan.elitePoolSize,
      requiredQuota: plan.input.maxNames,
      quotaMet: loopAvail.length >= plan.input.maxNames,
      skipped: loopAvail.length < plan.input.maxNames,
      limitHit,
      skipReason,
      consideredCount: considered,
      batchCount: batches,
      discoveredCount: rankedAvailableAll.length,
      availableCount: rankedAvailableAll.length,
      withinBudgetCount: rankedLoop.length,
      overBudgetCount: loopOverBudget.length,
      averageOverallScore: avg,
      averageValueRatio: avgValueRatio,
      underpricedCount,
      curatedCoveragePct: Number(coverage.coveragePct || 0),
      curatedCoverageAssessed: Number(coverage.assessedTarget || 0),
      curatedCoverageTotal: Number(coverage.total || 0),
      curatedCoverageNeedRemaining: Number(coverage.needRemaining || 0),
      topDomain: top ? top.domain : undefined,
      topScore: top ? top.overallScore : undefined,
      nameSource,
    });

    patch(job, {
      status: 'running',
      phase: 'looping',
      progress: progress(input.loopCount, loop, 1),
      currentLoop: loop,
      totalLoops: input.loopCount,
      results: makeSnapshot([]),
    });

    await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 120)));
  }

  if (VDATA_LOADED) {
    patch(job, { phase: 'enrichment', progress: 96 });
    try {
      const allDomains = [...availableMap.values(), ...overBudgetMap.values()];
      const allWords = new Set();
      for (const dom of allDomains) {
        const seg = segmentWords((dom.domain || '').split('.')[0]);
        for (const w of seg.words) allWords.add(w);
      }
      const keywordTokensForEvidence = new Set();
      for (const token of (optimizer.curTokens || [])) keywordTokensForEvidence.add(String(token || '').toLowerCase());
      if (keywordLibrary && Array.isArray(keywordLibrary.tokens)) {
        for (const token of keywordLibrary.tokens.slice(0, 40)) keywordTokensForEvidence.add(String(token || '').toLowerCase());
      }
      const wordsForDev = [...new Set([...allWords, ...keywordTokensForEvidence].filter(Boolean))];
      const devScores = await fetchDevEcosystemScores(wordsForDev, input);
      keywordState.devEcosystemStatus = DEV_ECOSYSTEM_LAST_META || null;
      const topDomains = sortRanked(allDomains, 'intrinsicValue').slice(0, 100).map(d => d.domain);
      const archiveHits = await checkArchiveHistory(topDomains);
      for (const dom of allDomains) {
        const seg = segmentWords((dom.domain || '').split('.')[0]);
        let devMax = 0;
        let bestDevWord = null;
        let bestDevDetail = null;
        for (const w of seg.words) {
          const wordScore = devScores.get(w) || 0;
          if (wordScore > devMax) {
            devMax = wordScore;
            bestDevWord = w;
            bestDevDetail = DEV_ECOSYSTEM_DETAIL_CACHE.get(w) || null;
          }
        }
        const enrich = {
          devEcosystemScore: devMax,
          archiveHistory: archiveHits.has(dom.domain),
          devEcosystemEvidence: bestDevWord ? {
            word: bestDevWord,
            total: devMax,
            githubRepos: bestDevDetail && Number.isFinite(bestDevDetail.githubRepos) ? bestDevDetail.githubRepos : null,
            npmPackages: bestDevDetail && Number.isFinite(bestDevDetail.npmPackages) ? bestDevDetail.npmPackages : null,
            source: bestDevDetail && bestDevDetail.source ? bestDevDetail.source : null,
            githubTokenUsed: Boolean(bestDevDetail && bestDevDetail.githubTokenUsed),
          } : null,
        };
        const updated = scoreDomain(dom, input, enrich);
        Object.assign(dom, updated);
        const key = dom.domain.toLowerCase();
        if (availableMap.has(key)) availableMap.set(key, dom);
        if (overBudgetMap.has(key)) overBudgetMap.set(key, dom);
      }
      emitDebugLog('engine.worker.js:run', 'API enrichment complete', {
        wordsQueried: wordsForDev.length,
        devScoresReturned: devScores.size,
        archiveHits: archiveHits.size,
        githubEvidence: keywordState.devEcosystemStatus || null,
      });
    } catch (enrichErr) {
      emitDebugLog('engine.worker.js:run', 'API enrichment failed (non-fatal)', { error: enrichErr.message || String(enrichErr) });
    }
  }

  await saveModel(optimizer.snapshot());

  patch(job, {
    status: 'done',
    phase: 'finalize',
    progress: 100,
    currentLoop: input.loopCount,
    totalLoops: input.loopCount,
    completedAt: now(),
    results: makeSnapshot([]),
  });
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

async function start(rawInput) {
  const active = Array.from(jobs.values()).find((job) => job.status === 'queued' || job.status === 'running');
  if (active) { emitError(`Run already active (${active.id}). Cancel or wait before starting another.`, active.id); return; }

  let input;
  try { input = parseInput(rawInput); } catch (err) { emitError(err instanceof Error ? err.message : 'Invalid input.'); return; }

  const createdAt = now();
  const job = {
    id: id(),
    status: 'queued',
    phase: null,
    progress: 0,
    input,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    currentLoop: 0,
    totalLoops: input.loopCount,
    results: { withinBudget: [], overBudget: [], unavailable: [], allRanked: [], loopSummaries: [], tuningHistory: [], pending: [], keywordLibrary: null },
    error: null,
  };

  jobs.set(job.id, job);
  emitJob(job);

  try {
    await run(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected run error.';
    sendIngest('engine.worker.js:start', 'Run failed (caught in start)', { jobId: job.id, errorMessage: message, progress: Number(job.progress || 0), phase: job.phase || null }, 'H7');
    emitDebugLog('engine.worker.js:start', 'Run failed', { jobId: job.id, error: message, progress: Number(job.progress || 0), phase: job.phase || null });
    patch(job, {
      status: 'failed',
      phase: 'finalize',
      progress: clamp(Math.round(job.progress || 0), 0, 100),
      completedAt: now(),
      error: { code: message.includes('canceled') ? 'CANCELED' : 'INTERNAL_ERROR', message },
    });
  } finally {
    canceled.delete(job.id);
  }
}

function cancel(jobId) {
  const jid = text(jobId);
  if (!jid) return;
  const job = jobs.get(jid);
  if (!job) return;
  if (job.status !== 'running' && job.status !== 'queued') return;
  canceled.add(jid);
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'start') { void start(msg.input || {}); return; }
  if (msg.type === 'cancel') { cancel(msg.jobId); return; }
  emitError(`Unknown worker command: ${String(msg.type || 'undefined')}`);
};
