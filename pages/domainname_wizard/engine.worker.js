const STYLE_VALUES = ['default', 'brandable', 'twowords', 'threewords', 'compound', 'spelling', 'nonenglish', 'dictionary'];
const RANDOMNESS_VALUES = ['low', 'medium', 'high'];
const LOOP_LIMIT = 251;
const MAX_STALL = 3;
const MAX_BATCH = 12;

const DB_NAME = 'domainname-wizard-browser';
const STORE = 'kv';
const MODEL_KEY = 'optimizer_v1';

const jobs = new Map();
const canceled = new Set();
let dbPromise = null;

const PREFIX = ['neo', 'prime', 'terra', 'ultra', 'atlas', 'delta', 'signal', 'lumen', 'forge', 'orbit'];
const SUFFIX = ['labs', 'works', 'base', 'flow', 'stack', 'hub', 'gen', 'pilot', 'ly', 'io'];
const DICT = ['horizon', 'ember', 'vector', 'harbor', 'beacon', 'origin', 'summit', 'apex'];
function now() { return Date.now(); }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round(v, d = 2) { return Number(v.toFixed(d)); }
function text(v) { return String(v || '').trim(); }

function id() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

function hash(s) {
  let h = 2166136261;
  const t = String(s || '');
  for (let i = 0; i < t.length; i += 1) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rand) { return arr[Math.floor(rand() * arr.length)] || ''; }

function emitError(message, jobId) { self.postMessage({ type: 'error', message: String(message || 'Worker error'), jobId: jobId || null }); }
function emitJob(job) { self.postMessage({ type: 'state', job: JSON.parse(JSON.stringify(job)) }); }
// #region agent log
function sendIngest(location, message, data, hypothesisId) {
  const payload = { sessionId: 'efbcb6', location: String(location || 'engine.worker.js'), message: String(message || 'log'), data: data || {}, timestamp: Date.now(), runId: 'run1', hypothesisId: hypothesisId || null };
  self.postMessage({ type: 'debugLog', payload: payload });
  fetch('http://127.0.0.1:7244/ingest/0500be7a-802e-498d-b34c-96092e89bf3b', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'efbcb6' }, body: JSON.stringify(payload) }).catch(function () {});
}
// #endregion
function emitDebugLog(location, message, data) {
  self.postMessage({
    type: 'debugLog',
    payload: {
      sessionId: '437d46',
      location: String(location || 'engine.worker.js'),
      message: String(message || 'log'),
      data: data || {},
      timestamp: Date.now(),
    },
  });
}

function patch(job, fields, emit = true) {
  Object.assign(job, fields);
  job.updatedAt = now();
  if (emit) emitJob(job);
}

function normalizeTld(v) {
  const tld = text(v).toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9-]{2,24}$/.test(tld)) return null;
  if (tld.startsWith('-') || tld.endsWith('-')) return null;
  return tld;
}

const COMB = /[\u0300-\u036f]/g;
function toLabel(v) {
  const s = text(v)
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMB, '')
    .replace(/&/g, ' and ')
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s || s.length > 63 || !/^[a-z0-9-]+$/.test(s)) return null;
  return s;
}

function tokenize(v) {
  return text(v)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function parseInput(raw) {
  const input = raw || {};
  const keywords = text(input.keywords);
  if (keywords.length < 2) throw new Error('Keywords must be at least 2 characters.');
  const style = STYLE_VALUES.includes(input.style) ? input.style : 'default';
  const randomness = RANDOMNESS_VALUES.includes(input.randomness) ? input.randomness : 'medium';
  const tld = normalizeTld(input.tld || 'com');
  if (!tld) throw new Error('Invalid TLD.');
  return {
    keywords,
    description: text(input.description),
    style,
    randomness,
    blacklist: text(input.blacklist),
    tld,
    maxLength: clamp(Math.round(Number(input.maxLength) || 25), 5, 25),
    maxNames: clamp(Math.round(Number(input.maxNames) || 100), 1, 250),
    yearlyBudget: clamp(Number(input.yearlyBudget) || 50, 1, 100000),
    loopCount: clamp(Math.round(Number(input.loopCount) || 10), 1, 25),
    apiBaseUrl: text(input.apiBaseUrl),
  };
}

function estimateSyllables(label) {
  const parts = String(label || '').split('-').filter(Boolean);
  if (!parts.length) return 1;
  return parts.reduce((sum, part) => {
    const groups = part.match(/[aeiouy]+/g);
    return sum + Math.max(1, groups ? groups.length : 0);
  }, 0);
}

function scoreDomain(row, input) {
  const parts = row.domain.split('.');
  const label = parts[0] || '';
  const tld = parts.slice(1).join('.') || input.tld;
  const len = label.length;
  const syl = estimateSyllables(label);
  const keyTokens = tokenize(`${input.keywords} ${input.description}`);

  const vowels = (label.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowels / Math.max(1, len);
  const pronounce = clamp(100 - Math.abs(vowelRatio - 0.42) * 210, 0, 100);
  const lengthScore = clamp(100 - Math.abs(len - 9) * 10, 0, 100);
  const sylScore = syl >= 2 && syl <= 3 ? 100 : syl === 1 || syl === 4 ? 78 : 52;
  let matches = 0;
  for (const token of keyTokens) if (label.includes(token)) matches += 1;
  const rel = keyTokens.length ? clamp(30 + (matches / keyTokens.length) * 70, 0, 100) : 35;
  const distinct = clamp((new Set(label.replace(/-/g, '').split('')).size / Math.max(1, label.replace(/-/g, '').length)) * 120, 0, 100);

  const tldFactor = ({ com: 1, io: 0.95, co: 0.93, ai: 0.94, net: 0.9, org: 0.9, app: 0.92 }[tld] || 0.85);
  const marketabilityScore = round(clamp((lengthScore * 0.22 + sylScore * 0.18 + pronounce * 0.2 + rel * 0.16 + distinct * 0.1 + (label.includes('-') ? 28 : 100) * 0.08 + (/\d/.test(label) ? 24 : 100) * 0.06) * tldFactor, 0, 100));

  const afford = typeof row.price === 'number' ? clamp(112 - (row.price / Math.max(1, input.yearlyBudget)) * 65, 0, 100) : 50;
  let financialValueScore = round(clamp((row.available ? 100 : 0) * 0.35 + (row.definitive ? 100 : 62) * 0.12 + afford * 0.38 + (row.isNamelixPremium ? 35 : 100) * 0.15, 0, 100));
  if (row.overBudget) financialValueScore = round(financialValueScore * 0.82);
  if (!row.available) financialValueScore = round(financialValueScore * 0.45);

  const overallScore = round(clamp(financialValueScore * 0.62 + marketabilityScore * 0.38, 0, 100));

  return {
    marketabilityScore,
    financialValueScore,
    overallScore,
    syllableCount: syl,
    labelLength: len,
    valueDrivers: [],
    valueDetractors: [],
  };
}

function sortRanked(rows, mode) {
  const out = (rows || []).slice();
  out.sort((a, b) => {
    if (mode === 'financialValue') return (b.financialValueScore || 0) - (a.financialValueScore || 0) || (b.overallScore || 0) - (a.overallScore || 0) || String(a.domain).localeCompare(String(b.domain));
    if (mode === 'alphabetical') return String(a.domain).localeCompare(String(b.domain)) || (b.overallScore || 0) - (a.overallScore || 0);
    if (mode === 'syllableCount') return (a.syllableCount || 0) - (b.syllableCount || 0) || (b.overallScore || 0) - (a.overallScore || 0);
    if (mode === 'labelLength') return (a.labelLength || 0) - (b.labelLength || 0) || (b.overallScore || 0) - (a.overallScore || 0);
    return (b.marketabilityScore || 0) - (a.marketabilityScore || 0) || (b.overallScore || 0) - (a.overallScore || 0) || String(a.domain).localeCompare(String(b.domain));
  });
  return out;
}

function sortByPrice(a, b) {
  const ap = typeof a.price === 'number' ? a.price : Number.POSITIVE_INFINITY;
  const bp = typeof b.price === 'number' ? b.price : Number.POSITIVE_INFINITY;
  return ap - bp || String(a.domain).localeCompare(String(b.domain));
}

function mergeBest(existing, next, loop) {
  if (!existing) return next;
  const nextPrice = typeof next.price === 'number' ? next.price : Number.POSITIVE_INFINITY;
  const existingPrice = typeof existing.price === 'number' ? existing.price : Number.POSITIVE_INFINITY;
  const better = (next.overallScore || 0) > (existing.overallScore || 0) || ((next.overallScore || 0) === (existing.overallScore || 0) && nextPrice < existingPrice);
  const chosen = better ? next : existing;
  // #region agent log
  if (existing.isNamelixPremium !== next.isNamelixPremium || existingPrice !== nextPrice) {
    self.postMessage({ type: 'debugLog', payload: { sessionId: '437d46', location: 'engine.worker.js:mergeBest', message: 'Merge diff premium/price', data: { domain: next.domain, existingPremium: existing.isNamelixPremium, nextPremium: next.isNamelixPremium, chosenPremium: chosen.isNamelixPremium, existingPrice: existing.price, nextPrice: next.price, chosenPrice: chosen.price, hypothesisId: 'H2' }, timestamp: Date.now() } });
  }
  // #endregion
  return {
    ...chosen,
    firstSeenLoop: Math.min(existing.firstSeenLoop || loop, next.firstSeenLoop || loop),
    lastSeenLoop: loop,
    timesDiscovered: (existing.timesDiscovered || 1) + 1,
  };
}

function scoreReward(rows) {
  if (!rows.length) return 0;
  const scores = rows.map((x) => x.overallScore || 0).sort((a, b) => b - a);
  const top = scores.slice(0, Math.min(5, scores.length));
  return round(clamp(top.reduce((s, v) => s + v, 0) / top.length / 100, 0, 1), 4);
}

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
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
      d.tokens[k] = { plays: Math.max(0, Math.floor(Number(v.plays) || 0)), reward: Number(v.reward) || 0 };
    }
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

class Optimizer {
  constructor(base, model, seed) {
    this.base = { ...base };
    this.model = sanitizeModel(model);
    this.rand = rng(seed || now());
    this.curTokens = tokenize(`${base.keywords} ${base.description}`).slice(0, 8);
    this.bestLoop = undefined;
    this.bestReward = -1;
  }

  avg(stat) { return stat.plays ? stat.reward / stat.plays : 0.55; }

  choose(map, keys, eps) {
    if (this.rand() < eps) return pick(keys, this.rand);
    let best = keys[0];
    let bestVal = -Infinity;
    for (const key of keys) {
      const value = this.avg(map[key]);
      if (value > bestVal || (value === bestVal && this.rand() > 0.5)) {
        best = key;
        bestVal = value;
      }
    }
    return best;
  }

  next(loop) {
    const style = this.choose(this.model.style, STYLE_VALUES, 0.24);
    const randomness = this.choose(this.model.randomness, RANDOMNESS_VALUES, 0.24);

    const tokenRank = Object.entries(this.model.tokens)
      .map(([token, stat]) => ({ token, avg: this.avg(stat) }))
      .sort((a, b) => b.avg - a.avg);
    const good = tokenRank.filter((x) => x.avg >= 0.58).map((x) => x.token).slice(0, 12);
    const weak = new Set(tokenRank.filter((x) => x.avg <= 0.4).map((x) => x.token).slice(0, 20));

    const baseTokens = tokenize(this.base.keywords).slice(0, 12);
    const intensity = this.rand() > 0.66 ? 'high' : this.rand() > 0.33 ? 'medium' : 'low';
    const mut = intensity === 'high' ? 3 : intensity === 'medium' ? 2 : 1;
    const next = this.curTokens.length ? this.curTokens.slice() : baseTokens.slice(0, 4);

    for (let i = 0; i < mut; i += 1) {
      if (next.length > 2) {
        const weakIdx = next.findIndex((t) => weak.has(t));
        const idx = weakIdx >= 0 ? weakIdx : Math.floor(this.rand() * next.length);
        next.splice(idx, 1);
      }
      const src = good.length && this.rand() > 0.2 ? good : baseTokens;
      const t = pick(src.length ? src : ['brand', 'company'], this.rand);
      if (t && !next.includes(t)) next.push(t);
    }

    this.curTokens = next.slice(0, 8);

    return {
      loop,
      sourceLoop: this.bestLoop,
      selectedStyle: style,
      selectedRandomness: randomness,
      selectedMutationIntensity: intensity,
      input: {
        ...this.base,
        style,
        randomness,
        keywords: this.curTokens.join(' ') || this.base.keywords,
      },
    };
  }

  record(plan, reward) {
    const r = clamp(Number(reward) || 0, 0, 1);
    this.model.style[plan.selectedStyle].plays += 1;
    this.model.style[plan.selectedStyle].reward += r;
    this.model.randomness[plan.selectedRandomness].plays += 1;
    this.model.randomness[plan.selectedRandomness].reward += r;

    const tokens = tokenize(`${plan.input.keywords} ${plan.input.description}`).slice(0, 12);
    for (const token of tokens) {
      if (!this.model.tokens[token]) this.model.tokens[token] = { plays: 0, reward: 0 };
      this.model.tokens[token].plays += 1;
      this.model.tokens[token].reward += r;
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
      reward: round(r, 4),
    };
  }

  snapshot() {
    this.model.tokens = Object.fromEntries(
      Object.entries(this.model.tokens)
        .sort((a, b) => ((b[1].plays ? b[1].reward / b[1].plays : 0.55) - (a[1].plays ? a[1].reward / a[1].plays : 0.55)))
        .slice(0, 300),
    );
    this.model.runCount += 1;
    this.model.updatedAt = now();
    return this.model;
  }
}

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

function makeBatch(plan, seed, target, seen) {
  const rand = rng(seed >>> 0);
  const tokens = tokenize(`${plan.keywords} ${plan.description}`).map((t) => t.replace(/[^a-z0-9]/g, '')).filter((t) => t.length >= 2);
  const pool = tokens.length ? tokens : ['nova', 'orbit', 'lumen', 'quant', 'forge', 'signal'];
  const blocked = new Set(text(plan.blacklist).split(',').map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean));
  const out = [];
  let tries = 0;
  while (out.length < target && tries < target * 20) {
    tries += 1;
    const a = pick(pool, rand);
    const b = pick(pool, rand);
    const c = pick(pool, rand);
    let sourceName = styleName(plan.style, a, b, c, rand);
    if (plan.randomness === 'high' && rand() > 0.45) sourceName += pick(SUFFIX, rand);
    if (plan.randomness === 'low' && sourceName.length > 16) sourceName = sourceName.slice(0, 16);
    const label = toLabel(sourceName);
    if (!label || label.length > plan.maxLength) continue;
    let isBlocked = false;
    for (const tok of blocked) if (tok && label.includes(tok)) { isBlocked = true; break; }
    if (isBlocked) continue;
    const domain = `${label}.${plan.tld}`;
    const key = domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const premium = (hash(`${domain}|premium`) % 100) < (plan.style === 'brandable' ? 22 : 12);
    const candidate = { domain, sourceName, isNamelixPremium: premium };
    // #region agent log
    if (out.length < 2) {
      self.postMessage({ type: 'debugLog', payload: { sessionId: '437d46', location: 'engine.worker.js:makeBatch', message: 'Candidate premium', data: { domain: candidate.domain, seed, isNamelixPremium: candidate.isNamelixPremium, hypothesisId: 'H1' }, timestamp: Date.now() } });
    }
    // #endregion
    out.push(candidate);
  }
  return out;
}

function progress(totalLoops, currentLoop, fraction) {
  if (totalLoops <= 0) return 100;
  const norm = (Math.max(0, currentLoop - 1) + clamp(fraction, 0, 1)) / totalLoops;
  return Math.round(5 + norm * 90);
}

const AVAILABILITY_CHUNK = 100;
const RDAP_DELAY_MS = 1200;
const LEGACY_VERCEL_BACKEND_URL = null;

async function fetchAvailability(apiBaseUrl, domains) {
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = base + '/api/domains/availability';
  const out = {};
  let _lastDebug = null;
  for (let i = 0; i < domains.length; i += AVAILABILITY_CHUNK) {
    const chunk = domains.slice(i, i + AVAILABILITY_CHUNK);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: chunk }),
      });
    } catch (err) {
      const msg = err && err.message ? err.message : 'Network error';
      // #region agent log
      sendIngest('engine.worker.js:fetchAvailability', 'Availability API fetch exception', { url, chunkSize: chunk.length, chunkOffset: i, errorMessage: msg }, 'H1');
      // #endregion
      emitDebugLog('engine.worker.js:fetchAvailability', 'Availability API fetch exception', {
        url,
        chunkSize: chunk.length,
        chunkOffset: i,
        error: msg,
      });
      throw new Error('Availability request failed: ' + msg);
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const statusMsg = String(res.status || 0) + (res.statusText ? ` ${res.statusText}` : '');
      const msg = data.message || data.code || statusMsg || 'Availability request failed.';
      // #region agent log
      sendIngest('engine.worker.js:fetchAvailability', 'Availability API non-OK response', { url, status: res.status, statusText: res.statusText, dataMessage: data.message, dataCode: data.code, errorMessage: msg }, 'H2');
      // #endregion
      emitDebugLog('engine.worker.js:fetchAvailability', 'Availability API non-OK response', {
        url,
        chunkSize: chunk.length,
        chunkOffset: i,
        status: res.status,
        statusText: res.statusText,
        errorMessage: msg,
      });
      throw new Error('Availability API error (' + statusMsg + '): ' + msg);
    }
    const results = data.results || {};
    if (data._debug) _lastDebug = data._debug;
    // #region agent log
    sendIngest('engine.worker.js:fetchAvailability', 'Availability API success response', {
      url,
      status: res.status,
      chunkSize: chunk.length,
      chunkOffset: i,
      resultCount: Object.keys(results).length,
      _debug: data._debug || null,
      syntheticData: false,
      sampleResults: Object.entries(results).slice(0, 3).map(function(e) { return { domain: e[0], available: e[1].available, price: e[1].price, reason: e[1].reason }; }),
    }, 'H1');
    // #endregion
    if (!results || typeof results !== 'object') {
      emitDebugLog('engine.worker.js:fetchAvailability', 'Availability API invalid payload', {
        url,
        chunkSize: chunk.length,
        chunkOffset: i,
      });
    }
    for (const key of Object.keys(results)) Object.assign(out, { [key]: results[key] });
  }
  out._debug = _lastDebug;
  return out;
}

async function fetchRdapAvailability(domains, jobId, onProgress) {
  const total = domains.length;
  const out = {};
  for (let i = 0; i < domains.length; i += 1) {
    if (jobId && canceled.has(jobId)) break;
    if (typeof onProgress === 'function') {
      const step = Math.max(1, Math.floor(total / 20));
      if (i % step === 0 || i === domains.length - 1) onProgress(i + 1, total);
    }
    const domain = domains[i];
    const key = domain.toLowerCase();
    const url = 'https://rdap.org/domain/' + encodeURIComponent(domain);
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { Accept: 'application/rdap+json, application/json' } });
    } catch (e) {
      out[key] = { available: false, definitive: false, reason: (e && e.message) || 'RDAP request failed.' };
      await new Promise(function (r) { setTimeout(r, RDAP_DELAY_MS); });
      continue;
    }
    if (res.status === 429) {
      await new Promise(function (r) { setTimeout(r, 11000); });
      i -= 1;
      continue;
    }
    try {
      const body = await res.text();
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch (_) {}
      const registered = res.status === 200 && parsed && parsed.objectClassName === 'domain';
      out[key] = {
        available: !registered,
        definitive: res.status === 200 || res.status === 404,
        reason: registered ? 'Registered (RDAP).' : (res.status === 404 ? 'No registration (RDAP).' : 'Unknown (RDAP).'),
      };
    } catch (e) {
      out[key] = { available: false, definitive: false, reason: (e && e.message) ? e.message : 'RDAP body/parse failed.' };
    }
    if (i < domains.length - 1) await new Promise(function (r) { setTimeout(r, RDAP_DELAY_MS); });
  }
  return out;
}

function snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pending) {
  const allRanked = sortRanked(Array.from(availableMap.values()), 'marketability');
  // #region agent log
  allRanked.slice(0, 2).forEach(function (r, i) {
    self.postMessage({ type: 'debugLog', payload: { sessionId: '437d46', location: 'engine.worker.js:snapshot', message: 'Snapshot row', data: { index: i, domain: r.domain, price: r.price, isNamelixPremium: r.isNamelixPremium, hypothesisId: 'H4' }, timestamp: Date.now() } });
  });
  // #endregion
  const withinBudgetOnly = allRanked.filter(function (r) { return r.overBudget !== true; });
  return {
    withinBudget: withinBudgetOnly.slice().sort(sortByPrice),
    overBudget: sortRanked(Array.from(overBudgetMap.values()), 'financialValue'),
    unavailable: sortRanked(Array.from(unavailableMap.values()), 'marketability'),
    allRanked,
    loopSummaries: loopSummaries.slice(),
    tuningHistory: tuningHistory.slice(),
    pending: Array.isArray(pending) ? pending : [],
  };
}

async function run(job) {
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

  const model = await loadModel();
  const optimizer = new Optimizer(input, model, hash(job.id));

  patch(job, { status: 'running', phase: 'looping', progress: 5, currentLoop: 0, totalLoops: input.loopCount, results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, []) });

  for (let loop = 1; loop <= input.loopCount; loop += 1) {
    if (canceled.has(job.id)) throw new Error('Run canceled by user.');

    const plan = optimizer.next(loop);
    const seen = new Set();
    const loopAvail = [];

    let considered = 0;
    let batches = 0;
    let limitHit = false;
    let stalls = 0;
    let skipReason;

    while (loopAvail.length < plan.input.maxNames) {
      if (canceled.has(job.id)) throw new Error('Run canceled by user.');
      if (considered >= LOOP_LIMIT) { limitHit = true; skipReason = `Considered-name cap of ${LOOP_LIMIT} reached.`; break; }
      if (batches >= MAX_BATCH) { skipReason = `Batch attempt cap (${MAX_BATCH}) reached before quota.`; break; }

      const remaining = plan.input.maxNames - loopAvail.length;
      const batchMax = clamp(Math.floor(Math.max(remaining * 3, remaining, Math.min(plan.input.maxNames, 80))), remaining, 250);
      const seed = hash(`${job.id}|${loop}|${batches}|${considered}`);

      patch(job, { status: 'running', phase: 'namelix', progress: progress(input.loopCount, loop, 0.03 + 0.72 * (loopAvail.length / Math.max(1, plan.input.maxNames))), currentLoop: loop, totalLoops: input.loopCount });

      const cands = makeBatch(plan.input, seed, batchMax, seen);
      // #region agent log
      if (loop === 1 && batches === 0) {
        sendIngest('engine.worker.js:run', 'Name generation source', {
          source: 'LOCAL (makeBatch combinatorics)',
          namelixApiCalled: false,
          syntheticNameGeneration: true,
          candidateCount: cands.length,
          sampleCandidates: cands.slice(0, 3).map(function(c) { return { domain: c.domain, isNamelixPremium: c.isNamelixPremium, premiumSource: 'hash-based (synthetic)' }; }),
          explanation: 'Names generated using local PREFIX/SUFFIX/DICT arrays and styleName combinatorics. No external Namelix API is called. isNamelixPremium is computed via hash(domain|premium) % 100 < threshold.',
        }, 'H3');
      }
      // #endregion
      considered += cands.length;
      batches += 1;

      const pendingRows = cands.map(function (c) { return { domain: c.domain, sourceName: c.sourceName, isNamelixPremium: c.isNamelixPremium }; });
      patch(job, { status: 'running', phase: 'godaddy', progress: progress(input.loopCount, loop, 0.1 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))), currentLoop: loop, totalLoops: input.loopCount, results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pendingRows) });

      let got = 0;
      let logCount = 0;
      const domainList = cands.map(function (c) { return c.domain; });
      let availabilityByDomain;
      if (useBackend) {
        // #region agent log
        sendIngest('engine.worker.js:run', 'About to call primary availability API', { url: backendBaseUrl + '/api/domains/availability', domainCount: domainList.length }, 'H5');
        // #endregion
        try {
          availabilityByDomain = await fetchAvailability(backendBaseUrl, domainList);
          // #region agent log
          if (availabilityByDomain._debug) {
            sendIngest('engine.worker.js:run', 'GoDaddy backend _debug metadata', { _debug: availabilityByDomain._debug }, 'H1');
            self.postMessage({ type: 'debugLog', payload: { sessionId: 'efbcb6', location: 'engine.worker.js:run', message: 'GoDaddy API debug info', data: availabilityByDomain._debug, timestamp: Date.now() } });
          }
          delete availabilityByDomain._debug;
          // #endregion
        } catch (error) {
          const primaryError = error instanceof Error ? error.message : String(error || 'unknown');
          // #region agent log
          sendIngest('engine.worker.js:run', 'Primary availability failed, falling back to RDAP', { primaryError, backendBaseUrl }, 'H4');
          // #endregion
          useBackend = false;
          patch(job, { phase: 'rdap' });
          availabilityByDomain = await fetchRdapAvailability(domainList, job.id, function (done, total) {
            const frac = total > 0 ? done / total : 0;
            patch(job, { phase: 'rdap', progress: progress(input.loopCount, loop, 0.1 + 0.5 * frac) });
          });
          emitDebugLog('engine.worker.js:run', 'Backend unavailable, switched to RDAP (no prices available)', {
            backendBaseUrl,
            error: primaryError,
          });
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
          const isNamelixPremium = price > plan.input.yearlyBudget || price > 500;
          result = {
            domain: cand.domain,
            sourceName: cand.sourceName,
            isNamelixPremium,
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
          const isNamelixPremium = typeof price === 'number' && (price > plan.input.yearlyBudget || price > 500);
          result = {
            domain: cand.domain,
            sourceName: cand.sourceName,
            isNamelixPremium: price != null ? isNamelixPremium : false,
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
            isNamelixPremium: false,
            available: false,
            definitive: false,
            price: undefined,
            currency: 'USD',
            period: 1,
            reason: 'No availability data (backend or RDAP).',
            overBudget: false,
          };
        }
        // #region agent log
        if (logCount < 2) {
          logCount += 1;
          self.postMessage({ type: 'debugLog', payload: { sessionId: '437d46', location: 'engine.worker.js:resultRow', message: 'Result price/premium', data: { domain: result.domain, isNamelixPremium: result.isNamelixPremium, price: result.price, hypothesisId: 'H4' }, timestamp: Date.now() } });
        }
        // #endregion
        const ranked = { ...result, ...scoreDomain(result, plan.input), firstSeenLoop: loop, lastSeenLoop: loop, timesDiscovered: 1 };

        if (result.available && !result.overBudget) {
          got += 1;
          loopAvail.push(ranked);
          const key = ranked.domain.toLowerCase();
          overBudgetMap.delete(key);
          availableMap.set(key, mergeBest(availableMap.get(key), ranked, loop));
        } else if (result.available && result.overBudget) {
          const key = ranked.domain.toLowerCase();
          availableMap.delete(key);
          overBudgetMap.set(key, mergeBest(overBudgetMap.get(key), ranked, loop));
        } else {
          const key = ranked.domain.toLowerCase();
          unavailableMap.set(key, mergeBest(unavailableMap.get(key), ranked, loop));
        }

        const nextPending = (job.results && job.results.pending) ? job.results.pending.filter(function (p) { return String(p.domain || '').toLowerCase() !== key; }) : [];
        patch(job, { results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, nextPending) });

        if (loopAvail.length >= plan.input.maxNames) break;
      }

      stalls = got === 0 ? stalls + 1 : 0;
      if (considered >= LOOP_LIMIT) { limitHit = true; skipReason = `Considered-name cap of ${LOOP_LIMIT} reached.`; }
      if (stalls >= MAX_STALL) { skipReason = `No newly qualifying domains across ${MAX_STALL} consecutive batches.`; break; }

      patch(job, {
        status: 'running',
        phase: 'looping',
        progress: progress(input.loopCount, loop, 0.2 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))),
        currentLoop: loop,
        totalLoops: input.loopCount,
        results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, []),
      });

      await new Promise((resolve) => setTimeout(resolve, 40 + Math.floor(Math.random() * 80)));
    }

    const rankedLoop = sortRanked(loopAvail, 'marketability');
    const reward = scoreReward(rankedLoop);
    const step = optimizer.record(plan, reward);
    tuningHistory.push(step);

    const avg = rankedLoop.length ? round(rankedLoop.reduce((s, r) => s + (r.overallScore || 0), 0) / rankedLoop.length, 2) : 0;
    const top = rankedLoop[0];

    loopSummaries.push({
      loop,
      keywords: plan.input.keywords,
      description: plan.input.description || '',
      style: plan.selectedStyle,
      randomness: plan.selectedRandomness,
      mutationIntensity: plan.selectedMutationIntensity,
      requiredQuota: plan.input.maxNames,
      quotaMet: loopAvail.length >= plan.input.maxNames,
      skipped: loopAvail.length < plan.input.maxNames,
      limitHit,
      skipReason,
      consideredCount: considered,
      batchCount: batches,
      discoveredCount: rankedLoop.length,
      availableCount: rankedLoop.length,
      withinBudgetCount: rankedLoop.length,
      averageOverallScore: avg,
      topDomain: top ? top.domain : undefined,
      topScore: top ? top.overallScore : undefined,
    });

    patch(job, {
      status: 'running',
      phase: 'looping',
      progress: progress(input.loopCount, loop, 1),
      currentLoop: loop,
      totalLoops: input.loopCount,
      results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, []),
    });

    await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 120)));
  }

  await saveModel(optimizer.snapshot());

  patch(job, {
    status: 'done',
    phase: 'finalize',
    progress: 100,
    currentLoop: input.loopCount,
    totalLoops: input.loopCount,
    completedAt: now(),
    results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, []),
  });
}

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
    results: { withinBudget: [], overBudget: [], unavailable: [], allRanked: [], loopSummaries: [], tuningHistory: [] },
    error: null,
  };

  jobs.set(job.id, job);
  emitJob(job);

  try {
    await run(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected run error.';
    // #region agent log
    sendIngest('engine.worker.js:start', 'Run failed (caught in start)', { jobId: job.id, errorMessage: message, progress: Number(job.progress || 0), phase: job.phase || null }, 'H7');
    // #endregion
    emitDebugLog('engine.worker.js:start', 'Run failed', {
      jobId: job.id,
      error: message,
      progress: Number(job.progress || 0),
      phase: job.phase || null,
    });
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
  const id = text(jobId);
  if (!id) return;
  const job = jobs.get(id);
  if (!job) return;
  if (job.status !== 'running' && job.status !== 'queued') return;
  canceled.add(id);
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'start') { void start(msg.input || {}); return; }
  if (msg.type === 'cancel') { cancel(msg.jobId); return; }
  emitError(`Unknown worker command: ${String(msg.type || 'undefined')}`);
};
