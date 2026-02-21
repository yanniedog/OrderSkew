// Domain Name Wizard - Web Worker Entry Point
// Loads modules and orchestrates the main run loop

const jobs = new Map();
const canceled = new Set();
let dbPromise = null;
const WORKER_ASSET_VERSION = '2026-02-20-1';
const RUN_HISTORY_STORE = 'run_history';
const MAX_DETAIL_ROWS = 200;

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
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(RUN_HISTORY_STORE)) db.createObjectStore(RUN_HISTORY_STORE, { keyPath: 'key' });
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
        consecutiveLoops: Math.max(0, Math.floor(Number(v.consecutiveLoops) || 0)),
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

function historyKey(jobId, type, loop) {
  return `${String(jobId || '')}:${String(type || '')}:${String(Math.max(0, Number(loop) || 0)).padStart(6, '0')}`;
}

function runHistoryPrefix(jobId, type) {
  return `${String(jobId || '')}:${String(type || '')}:`;
}

async function appendRunHistory(jobId, type, loop, value) {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RUN_HISTORY_STORE, 'readwrite');
      tx.objectStore(RUN_HISTORY_STORE).put({
        key: historyKey(jobId, type, loop),
        jobId: String(jobId || ''),
        type: String(type || ''),
        loop: Math.max(0, Number(loop) || 0),
        value: value || null,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore history persistence errors.
  }
}

async function clearRunHistory(jobId) {
  const db = await openDb();
  if (!db) return;
  const job = String(jobId || '');
  if (!job) return;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RUN_HISTORY_STORE, 'readwrite');
      const store = tx.objectStore(RUN_HISTORY_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (String(cursor.value && cursor.value.jobId) === job) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore history cleanup errors.
  }
}

async function readRunHistory(jobId, type) {
  const db = await openDb();
  if (!db) return [];
  const prefix = runHistoryPrefix(jobId, type);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RUN_HISTORY_STORE, 'readonly');
      const store = tx.objectStore(RUN_HISTORY_STORE);
      const req = store.openCursor();
      const out = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String(cursor.key || '');
        if (key.startsWith(prefix) && cursor.value && cursor.value.value) out.push(cursor.value.value);
        cursor.continue();
      };
      tx.oncomplete = () => resolve(out.sort((a, b) => (Number(a.loop) || 0) - (Number(b.loop) || 0)));
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

function summarizeFactors(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.slice(0, 3).map(function (x) {
    return `${x.component || ''} (${round(Number(x.impact) || 0, 1)})`;
  }).join(', ');
}

function compactRankedRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    domain: row.domain,
    sourceName: row.sourceName,
    premiumPricing: Boolean(row.premiumPricing),
    available: row.available,
    definitive: Boolean(row.definitive),
    price: row.price,
    currency: row.currency || 'USD',
    period: row.period != null ? row.period : 1,
    reason: row.reason || '',
    overBudget: Boolean(row.overBudget),
    marketabilityScore: Number(row.marketabilityScore || 0),
    financialValueScore: Number(row.financialValueScore || 0),
    overallScore: Number(row.overallScore || 0),
    intrinsicValue: Number(row.intrinsicValue || 0),
    phoneticScore: Number(row.phoneticScore || 0),
    brandabilityScore: Number(row.brandabilityScore || 0),
    seoScore: Number(row.seoScore || 0),
    commercialScore: Number(row.commercialScore || 0),
    memorabilityScore: Number(row.memorabilityScore || 0),
    realWordPartsScore: Number(row.realWordPartsScore || 0),
    cpcKeywordScore: Number(row.cpcKeywordScore || 0),
    bestCpcTier: Number(row.bestCpcTier || 0),
    bestCpcWord: row.bestCpcWord || '',
    cvFlowScore: Number(row.cvFlowScore || 0),
    keywordMatchScore: Number(row.keywordMatchScore || 0),
    devSignalScore: Number(row.devSignalScore || 0),
    notesPriorityScore: Number(row.notesPriorityScore || 0),
    syllableCount: Number(row.syllableCount || 0),
    labelLength: Number(row.labelLength || 0),
    estimatedValueUSD: Number(row.estimatedValueUSD || 0),
    estimatedValueLow: Number(row.estimatedValueLow || 0),
    estimatedValueHigh: Number(row.estimatedValueHigh || 0),
    valueConfidence: row.valueConfidence || null,
    valueRatio: row.valueRatio == null ? null : Number(row.valueRatio || 0),
    underpricedFlag: row.underpricedFlag || null,
    liquidityScore: Number(row.liquidityScore || 0),
    timeToSaleMonths: Number(row.timeToSaleMonths || 0),
    saleProbability24m: Number(row.saleProbability24m || 0),
    ev24m: Number(row.ev24m || 0),
    expectedROI: row.expectedROI == null ? null : Number(row.expectedROI || 0),
    comparableMedianPrice: Number(row.comparableMedianPrice || 0),
    devEcosystemScore: Number(row.devEcosystemScore || 0),
    hasArchiveHistory: Boolean(row.hasArchiveHistory),
    segmentedWords: Array.isArray(row.segmentedWords) ? row.segmentedWords.slice(0, 10) : [],
    valueDriversSummary: row.valueDriversSummary || summarizeFactors(row.valueDrivers),
    valueDetractorsSummary: row.valueDetractorsSummary || summarizeFactors(row.valueDetractors),
    devEcosystemEvidence: row.devEcosystemEvidence || null,
    firstSeenLoop: Number(row.firstSeenLoop || 0),
    lastSeenLoop: Number(row.lastSeenLoop || 0),
    timesDiscovered: Number(row.timesDiscovered || 1),
  };
}

function compactUnavailableRow(row) {
  const compact = compactRankedRow(row);
  if (!compact || typeof compact !== 'object') return compact;
  compact.segmentedWords = [];
  compact.devEcosystemEvidence = null;
  return compact;
}

function trackRowDetails(detailStore, row) {
  if (!detailStore || !(detailStore instanceof Map) || !row || !row.domain) return;
  const key = String(row.domain || '').toLowerCase();
  const detail = {
    domain: row.domain,
    score: Number(row.overallScore || 0),
    comparableSales: Array.isArray(row.comparableSales) ? row.comparableSales.slice(0, 8) : [],
    valueDrivers: Array.isArray(row.valueDrivers) ? row.valueDrivers.slice(0, 8) : [],
    valueDetractors: Array.isArray(row.valueDetractors) ? row.valueDetractors.slice(0, 8) : [],
  };
  if (detailStore.has(key)) {
    detailStore.set(key, detail);
    return;
  }
  if (detailStore.size < MAX_DETAIL_ROWS) {
    detailStore.set(key, detail);
    return;
  }
  let minKey = null;
  let minScore = Number.POSITIVE_INFINITY;
  for (const [k, v] of detailStore.entries()) {
    const s = Number(v && v.score) || 0;
    if (s < minScore) {
      minScore = s;
      minKey = k;
    }
  }
  if (detail.score > minScore && minKey) {
    detailStore.delete(minKey);
    detailStore.set(key, detail);
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pending, keywordState, meta) {
  const m = meta || {};
  const keywordRowsLimit = Math.max(20, Math.min(240, Number(m.keywordRowsLimit) || 120));
  const allRanked = sortRanked(Array.from(availableMap.values()), 'marketability');
  const withinBudgetOnly = allRanked.filter(function (r) { return r.overBudget !== true; });
  let keywordLibrary = null;
  if (keywordState && keywordState.optimizer && typeof keywordState.optimizer.getKeywordLibraryRows === 'function') {
    const lib = keywordState.library || {};
    const coverage = typeof keywordState.optimizer.getCoverageMetrics === 'function'
      ? keywordState.optimizer.getCoverageMetrics()
      : null;
    keywordLibrary = {
      seedTokens: Array.isArray(lib.seedTokens) ? lib.seedTokens.slice(0, 16) : [],
      currentKeywords: Array.isArray(keywordState.optimizer.curTokens) ? keywordState.optimizer.curTokens.slice(0, 8) : [],
      tokens: keywordState.optimizer.getKeywordLibraryRows(keywordRowsLimit),
      apiStatus: lib.apiStatus || null,
      devEcosystemStatus: keywordState.devEcosystemStatus || null,
      coverageMetrics: coverage || null,
    };
  } else if (keywordState && keywordState.library) {
    const lib = keywordState.library || {};
    const fallbackTokens = Array.isArray(lib.tokens) ? lib.tokens.slice(0, keywordRowsLimit) : [];
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
      coverageMetrics: null,
    };
  }
  return {
    resultsVersion: Number(m.resultsVersion || 0),
    withinBudget: withinBudgetOnly.slice().sort(sortByPrice),
    overBudget: sortRanked(Array.from(overBudgetMap.values()), 'financialValue'),
    unavailable: sortRanked(Array.from(unavailableMap.values()), 'marketability'),
    allRanked,
    loopSummaries: loopSummaries.slice(),
    tuningHistory: tuningHistory.slice(),
    pending: Array.isArray(pending) ? pending : [],
    keywordLibrary,
    unavailableTotalSeen: Number(m.unavailableTotalSeen || 0),
    unavailableDropped: Number(m.unavailableDropped || 0),
    historyWindowStartLoop: Number(m.historyWindowStartLoop || 1),
    historyTruncated: Boolean(m.historyTruncated),
  };
}

// ---------------------------------------------------------------------------
// Main run loop
// ---------------------------------------------------------------------------

async function run(job) {
  clearRunCaches();
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
  const detailStore = new Map();
  const lowMemoryMode = input.lowMemoryMode !== false;
  const unavailableCap = lowMemoryMode ? 1500 : 4000;
  const loopHistoryRamCap = lowMemoryMode ? 120 : 240;
  const recentHistoryLoops = 40;
  const keywordRowsLimit = lowMemoryMode ? 80 : 120;
  const snapshotThrottleMs = lowMemoryMode ? 650 : 240;
  let unavailableTotalSeen = 0;
  let unavailableDropped = 0;
  let latestLoopRecorded = 0;
  let resultsVersion = 0;
  let lastResultsEmitAt = 0;
  let historyTruncated = false;
  await clearRunHistory(job.id);

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
    const historyWindowStartLoop = Math.max(1, latestLoopRecorded - Math.max(1, recentHistoryLoops) + 1);
    return snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pending, keywordState, {
      keywordRowsLimit,
      resultsVersion,
      unavailableTotalSeen,
      unavailableDropped,
      historyWindowStartLoop,
      historyTruncated,
    });
  };
  const pushBounded = function (arr, item) {
    arr.push(item);
    if (arr.length > loopHistoryRamCap) {
      arr.shift();
      historyTruncated = true;
    }
  };
  const persistLoopHistory = async function (loopSummary, tuningStep) {
    if (loopSummary) await appendRunHistory(job.id, 'loop', loopSummary.loop, loopSummary);
    if (tuningStep) await appendRunHistory(job.id, 'tuning', tuningStep.loop, tuningStep);
  };
  const emitProgressOnly = function (fields) {
    patch(job, { ...fields, resultsVersion }, true, { includeResults: false });
  };
  const emitSnapshot = function (fields, pendingRows, force) {
    const nowTs = now();
    const shouldEmitResults = Boolean(force) || (nowTs - lastResultsEmitAt >= snapshotThrottleMs);
    if (shouldEmitResults) {
      resultsVersion += 1;
      lastResultsEmitAt = nowTs;
      patch(job, { ...fields, resultsVersion, results: makeSnapshot(pendingRows || []) }, true, { includeResults: true });
      return;
    }
    emitProgressOnly(fields);
  };

  emitSnapshot({ status: 'running', phase: 'looping', progress: 5, currentLoop: 0, totalLoops: input.loopCount }, [], true);

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
      emitProgressOnly({ status: 'running', phase: 'namelix', progress: progress(input.loopCount, loop, 0.03), currentLoop: loop, totalLoops: input.loopCount });

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

      if (considered >= LOOP_LIMIT) {
        limitHit = true;
        skipReason = 'Loop consider limit reached (251)';
        break;
      }
      const remainingConsider = Math.max(0, LOOP_LIMIT - considered);
      if (remainingConsider <= 0) {
        limitHit = true;
        skipReason = 'Loop consider limit reached (251)';
        break;
      }
      if (cands.length > remainingConsider) cands = cands.slice(0, remainingConsider);
      considered += cands.length;
      if (considered >= LOOP_LIMIT) limitHit = true;
      batches += 1;
      const pendingRows = cands.map(function (c) { return { domain: c.domain, sourceName: c.sourceName, premiumPricing: c.premiumPricing }; });
      emitSnapshot({ status: 'running', phase: 'godaddy', progress: progress(input.loopCount, loop, 0.1 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))), currentLoop: loop, totalLoops: input.loopCount }, pendingRows, false);

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
          emitProgressOnly({ phase: 'rdap' });
          availabilityByDomain = await fetchRdapAvailability(domainList, job.id, function (done, total) {
            const frac = total > 0 ? done / total : 0;
            emitProgressOnly({ phase: 'rdap', progress: progress(input.loopCount, loop, 0.1 + 0.5 * frac) });
          });
          emitDebugLog('engine.worker.js:run', 'Backend unavailable, switched to RDAP (no prices available)', { backendBaseUrl, error: primaryError });
        }
      } else {
        emitProgressOnly({ phase: 'rdap' });
        availabilityByDomain = await fetchRdapAvailability(domainList, job.id, function (done, total) {
          const frac = total > 0 ? done / total : 0;
          emitProgressOnly({ phase: 'rdap', progress: progress(input.loopCount, loop, 0.1 + 0.5 * frac) });
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

        const fullRanked = { ...result, ...scoreDomain(result, plan.input), firstSeenLoop: loop, lastSeenLoop: loop, timesDiscovered: 1 };
        trackRowDetails(detailStore, fullRanked);
        const ranked = result.available ? compactRankedRow(fullRanked) : compactUnavailableRow(fullRanked);
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
          unavailableTotalSeen += 1;
          const hadUnavailable = unavailableMap.has(key);
          unavailableMap.set(key, mergeBest(unavailableMap.get(key), ranked, loop));
          if (!hadUnavailable && unavailableMap.size > unavailableCap) {
            const firstKey = unavailableMap.keys().next().value;
            if (firstKey != null) {
              unavailableMap.delete(firstKey);
              unavailableDropped += 1;
            }
          }
        }
      }

      if (gotWithinBudget > 0) stalls = 0;
      else stalls += 1;

      if (loopAvail.length >= plan.input.maxNames) {
        limitHit = true;
        break;
      }

      emitSnapshot({
        status: 'running',
        phase: 'looping',
        progress: progress(input.loopCount, loop, 0.2 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))),
        currentLoop: loop,
        totalLoops: input.loopCount,
      }, [], false);
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
    latestLoopRecorded = Math.max(latestLoopRecorded, Number(step.loop || loop));
    pushBounded(tuningHistory, step);

    const avg = rankedAvailableAll.length ? round(rankedAvailableAll.reduce((s, r) => s + (r.overallScore || 0), 0) / rankedAvailableAll.length, 2) : 0;
    const valueRatios = rankedLoop.map((r) => Number(r.valueRatio) || 0).filter((v) => v > 0);
    const avgValueRatio = valueRatios.length ? round(valueRatios.reduce((s, v) => s + v, 0) / valueRatios.length, 3) : 0;
    const underpricedCount = rankedLoop.filter((r) => Boolean(r.underpricedFlag)).length;
    const top = rankedAvailableAll[0];

    const loopSummary = {
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
      curatedCoverageTargetPct: Number(coverage.coverageTargetPct || 0),
      curatedCoverageAssessed: Number(coverage.assessedTarget || 0),
      curatedCoverageAssessedOnce: Number(coverage.assessedOnce || 0),
      curatedCoverageTotal: Number(coverage.total || 0),
      curatedCoverageNeedRemaining: Number(coverage.needRemaining || 0),
      topDomain: top ? top.domain : undefined,
      topScore: top ? top.overallScore : undefined,
      nameSource,
    };
    pushBounded(loopSummaries, loopSummary);
    await persistLoopHistory(loopSummary, step);

    emitSnapshot({
      status: 'running',
      phase: 'looping',
      progress: progress(input.loopCount, loop, 1),
      currentLoop: loop,
      totalLoops: input.loopCount,
    }, [], true);

    await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 120)));
  }

  if (VDATA_LOADED) {
    emitProgressOnly({ phase: 'enrichment', progress: 96 });
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
        const fullUpdated = { ...dom, ...updated };
        trackRowDetails(detailStore, fullUpdated);
        const compactUpdated = compactRankedRow(fullUpdated);
        const key = dom.domain.toLowerCase();
        if (availableMap.has(key)) availableMap.set(key, compactUpdated);
        if (overBudgetMap.has(key)) overBudgetMap.set(key, compactUpdated);
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

  emitSnapshot({
    status: 'done',
    phase: 'finalize',
    progress: 100,
    currentLoop: input.loopCount,
    totalLoops: input.loopCount,
    completedAt: now(),
  }, [], true);
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
    resultsVersion: 0,
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

async function emitHistory(jobId, requestId) {
  const jid = text(jobId);
  if (!jid) {
    self.postMessage({ type: 'history', requestId: requestId || null, jobId: null, loopSummaries: [], tuningHistory: [] });
    return;
  }
  const [loopSummaries, tuningHistory] = await Promise.all([
    readRunHistory(jid, 'loop'),
    readRunHistory(jid, 'tuning'),
  ]);
  self.postMessage({
    type: 'history',
    requestId: requestId || null,
    jobId: jid,
    loopSummaries,
    tuningHistory,
  });
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'start') { void start(msg.input || {}); return; }
  if (msg.type === 'cancel') { cancel(msg.jobId); return; }
  if (msg.type === 'getHistory') { void emitHistory(msg.jobId, msg.requestId); return; }
  emitError(`Unknown worker command: ${String(msg.type || 'undefined')}`);
};
