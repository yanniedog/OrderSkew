// Domain Name Wizard - External API integration
// Depends on: worker-utils.js

// ---------------------------------------------------------------------------
// Fetch: Namelix names
// ---------------------------------------------------------------------------

async function fetchNamelixNames(apiBaseUrl, plan, prevNames) {
  const base = String(apiBaseUrl).replace(/\/+$/, '');
  const url = base + '/api/names/generate';
  const payload = {
    keywords: plan.keywords,
    description: plan.description || '',
    blacklist: plan.blacklist || '',
    maxLength: plan.maxLength || 10,
    tld: plan.tld || 'com',
    style: plan.preferEnglish !== false && plan.style === 'nonenglish' ? 'default' : (plan.style || 'default'),
    randomness: plan.randomness || 'medium',
    maxNames: plan.maxNames || 30,
    prevNames: prevNames || [],
    preferEnglish: plan.preferEnglish !== false,
  };
  sendIngest('worker-api.js:fetchNamelixNames', 'Calling Namelix name generation API', { url, keywords: payload.keywords, style: payload.style, maxNames: payload.maxNames }, 'H3');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err && err.message ? err.message : 'Namelix API request failed';
    sendIngest('worker-api.js:fetchNamelixNames', 'Namelix API fetch exception', { url, error: msg }, 'H3');
    throw new Error('Namelix request failed: ' + msg);
  }
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    const msg = data.message || data.code || ('Namelix API error ' + res.status);
    sendIngest('worker-api.js:fetchNamelixNames', 'Namelix API non-OK response', { url, status: res.status, message: msg, _debug: data._debug || null }, 'H3');
    throw new Error(msg);
  }
  const names = data.names || [];
  sendIngest('worker-api.js:fetchNamelixNames', 'Namelix API success', {
    url,
    nameCount: names.length,
    _debug: data._debug || null,
    sampleNames: names.slice(0, 5).map(function (n) { return { domain: n.domain, businessName: n.businessName, source: n.source }; }),
  }, 'H3');
  if (data._debug) {
    self.postMessage({ type: 'debugLog', payload: { sessionId: 'efbcb6', location: 'worker-api.js:fetchNamelixNames', message: 'Namelix API debug info', data: data._debug, timestamp: Date.now() } });
  }
  return names;
}

function normalizeKeywordToken(token) {
  return String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeKeywordPhrase(phrase) {
  return String(phrase || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function keywordEnglishPass(token, preferEnglish) {
  if (!token) return false;
  if (!preferEnglish) return true;
  return /^[a-z]+$/.test(token);
}

function tokenRoot(token) {
  const clean = normalizeKeywordToken(token);
  if (!clean) return '';
  let root = clean;
  if (root.endsWith('ies') && root.length > 4) root = `${root.slice(0, -3)}y`;
  else if (root.endsWith('ing') && root.length > 5) root = root.slice(0, -3);
  else if (root.endsWith('ers') && root.length > 5) root = root.slice(0, -3);
  else if (root.endsWith('ed') && root.length > 4) root = root.slice(0, -2);
  else if (root.endsWith('es') && root.length > 4) root = root.slice(0, -2);
  else if (root.endsWith('s') && root.length > 3) root = root.slice(0, -1);
  return root;
}

function isMirroredKeywordToken(a, b) {
  const aa = normalizeKeywordToken(a);
  const bb = normalizeKeywordToken(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const ar = tokenRoot(aa);
  const br = tokenRoot(bb);
  if (ar && br && ar.length >= 3 && ar === br) return true;
  if (aa.length >= 4 && bb.length >= 4 && (aa.includes(bb) || bb.includes(aa)) && Math.abs(aa.length - bb.length) <= 3) return true;
  return false;
}

function reduceMirroredKeywordTokens(tokens, maxCount) {
  const out = [];
  for (const token of tokens || []) {
    const clean = normalizeKeywordToken(token);
    if (!clean) continue;
    let mirrored = false;
    for (const kept of out) {
      if (isMirroredKeywordToken(clean, kept)) {
        mirrored = true;
        break;
      }
    }
    if (mirrored) continue;
    out.push(clean);
    if (out.length >= maxCount) break;
  }
  return out;
}

function addScoredToken(map, token, score) {
  const t = normalizeKeywordToken(token);
  if (!t || t.length < 2 || t.length > 24) return;
  const prev = map.get(t) || 0;
  if (score > prev) map.set(t, score);
}

function addScoredPhrase(map, phrase, score) {
  const p = normalizeKeywordPhrase(phrase);
  if (!p || p.length < 3 || p.length > 48) return;
  if (!p.includes(' ')) return;
  const prev = map.get(p) || 0;
  if (score > prev) map.set(p, score);
}

async function fetchAssociatedKeywordLibrary(seedText, options) {
  const opts = options || {};
  const preferEnglish = opts.preferEnglish !== false;
  const maxSeeds = Math.max(1, Math.min(10, Number(opts.maxSeeds) || 8));
  const seeds = tokenize(seedText).map(normalizeKeywordToken).filter(Boolean).slice(0, maxSeeds);
  const tokenScores = new Map();
  const phraseScores = new Map();

  for (const seed of seeds) addScoredToken(tokenScores, seed, 1000);
  const endpoints = [];
  for (const seed of seeds) {
    endpoints.push(
      `https://api.datamuse.com/words?ml=${encodeURIComponent(seed)}&max=30`,
      `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(seed)}&max=30`,
      `https://api.datamuse.com/words?rel_trg=${encodeURIComponent(seed)}&max=20`,
    );
  }
  const apiStatus = {
    provider: 'datamuse',
    accessible: false,
    attempted: endpoints.length,
    success: 0,
    failed: 0,
    errorCount: 0,
    httpErrorCount: 0,
    parseErrorCount: 0,
    networkErrorCount: 0,
    sampleErrors: [],
  };

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        apiStatus.failed += 1;
        apiStatus.httpErrorCount += 1;
        if (apiStatus.sampleErrors.length < 5) apiStatus.sampleErrors.push(`HTTP ${resp.status} (${url})`);
        continue;
      }
      apiStatus.success += 1;
      const payload = await resp.json();
      if (!Array.isArray(payload)) {
        apiStatus.parseErrorCount += 1;
        if (apiStatus.sampleErrors.length < 5) apiStatus.sampleErrors.push(`Invalid payload (${url})`);
        continue;
      }
      for (const item of payload) {
        const phrase = normalizeKeywordPhrase(item && item.word);
        const score = Number(item && item.score) || 0;
        if (!phrase) continue;
        if (phrase.includes(' ')) addScoredPhrase(phraseScores, phrase, score);
        for (const token of phrase.split(/\s+/)) {
          const cleaned = normalizeKeywordToken(token);
          if (!keywordEnglishPass(cleaned, preferEnglish)) continue;
          addScoredToken(tokenScores, cleaned, score);
        }
      }
    } catch (err) {
      apiStatus.failed += 1;
      apiStatus.errorCount += 1;
      apiStatus.networkErrorCount += 1;
      if (apiStatus.sampleErrors.length < 5) {
        const msg = err && err.message ? err.message : String(err || 'unknown error');
        apiStatus.sampleErrors.push(`${msg} (${url})`);
      }
    }
    await new Promise(function (r) { setTimeout(r, 60); });
  }
  apiStatus.accessible = apiStatus.success > 0;

  emitDebugLog('worker-api.js:fetchAssociatedKeywordLibrary', 'Synonym API accessibility', {
    provider: apiStatus.provider,
    accessible: apiStatus.accessible,
    attempted: apiStatus.attempted,
    success: apiStatus.success,
    failed: apiStatus.failed,
    httpErrorCount: apiStatus.httpErrorCount,
    parseErrorCount: apiStatus.parseErrorCount,
    networkErrorCount: apiStatus.networkErrorCount,
    sampleErrors: apiStatus.sampleErrors,
    seedCount: seeds.length,
  });

  const rankedTokens = Array.from(tokenScores.entries())
    .filter(function (entry) { return keywordEnglishPass(entry[0], preferEnglish); })
    .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); })
    .map(function (entry) { return entry[0]; });
  const filteredTokens = reduceMirroredKeywordTokens(rankedTokens, 120);

  const rankedPhrases = Array.from(phraseScores.entries())
    .filter(function (entry) {
      if (!preferEnglish) return true;
      return entry[0].split(/\s+/).every(function (t) { return /^[a-z]+$/.test(t); });
    })
    .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); })
    .map(function (entry) { return entry[0]; })
    .slice(0, 60);

  return {
    seedTokens: seeds,
    tokens: filteredTokens,
    phrases: rankedPhrases,
    keywordString: filteredTokens.slice(0, 8).join(' '),
    apiStatus,
  };
}

// ---------------------------------------------------------------------------
// Fetch: GoDaddy availability
// ---------------------------------------------------------------------------

const AVAILABILITY_CHUNK = 100;

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
      sendIngest('worker-api.js:fetchAvailability', 'Availability API fetch exception', { url, chunkSize: chunk.length, chunkOffset: i, errorMessage: msg }, 'H1');
      emitDebugLog('worker-api.js:fetchAvailability', 'Availability API fetch exception', { url, chunkSize: chunk.length, chunkOffset: i, error: msg });
      throw new Error('Availability request failed: ' + msg);
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const statusMsg = String(res.status || 0) + (res.statusText ? ` ${res.statusText}` : '');
      const msg = data.message || data.code || statusMsg || 'Availability request failed.';
      sendIngest('worker-api.js:fetchAvailability', 'Availability API non-OK response', { url, status: res.status, statusText: res.statusText, dataMessage: data.message, dataCode: data.code, errorMessage: msg }, 'H2');
      emitDebugLog('worker-api.js:fetchAvailability', 'Availability API non-OK response', { url, chunkSize: chunk.length, chunkOffset: i, status: res.status, statusText: res.statusText, errorMessage: msg });
      throw new Error('Availability API error (' + statusMsg + '): ' + msg);
    }
    const results = data.results || {};
    if (data._debug) _lastDebug = data._debug;
    sendIngest('worker-api.js:fetchAvailability', 'Availability API success response', {
      url, status: res.status, chunkSize: chunk.length, chunkOffset: i,
      resultCount: Object.keys(results).length, _debug: data._debug || null, syntheticData: false,
      sampleResults: Object.entries(results).slice(0, 3).map(function(e) { return { domain: e[0], available: e[1].available, price: e[1].price, reason: e[1].reason }; }),
    }, 'H1');
    if (!results || typeof results !== 'object') {
      emitDebugLog('worker-api.js:fetchAvailability', 'Availability API invalid payload', { url, chunkSize: chunk.length, chunkOffset: i });
    }
    for (const key of Object.keys(results)) Object.assign(out, { [key]: results[key] });
  }
  out._debug = _lastDebug;
  return out;
}

// ---------------------------------------------------------------------------
// Fetch: RDAP fallback
// ---------------------------------------------------------------------------

const RDAP_DELAY_MS = 1200;

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

// ---------------------------------------------------------------------------
// API Enrichment: Developer Ecosystem (GitHub, npm, PyPI)
// ---------------------------------------------------------------------------

async function fetchDevEcosystemScores(words, input) {
  const scores = new Map();
  if (!words || words.length === 0) return scores;
  const unique = [...new Set(words.filter(w => w.length >= 3))].slice(0, 30);
  const apiBaseUrl = String(input.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const githubToken = input.githubToken || '';

  for (const word of unique) {
    if (DEV_ECOSYSTEM_CACHE.has(word)) {
      scores.set(word, DEV_ECOSYSTEM_CACHE.get(word));
      continue;
    }
    scores.set(word, 0);
  }

  const toFetch = unique.filter(w => !DEV_ECOSYSTEM_CACHE.has(w));
  if (toFetch.length === 0) return scores;

  if (apiBaseUrl) {
    try {
      const res = await fetch(apiBaseUrl + '/api/dev-ecosystem', {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: toFetch }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (res.ok && data.scores && typeof data.scores === 'object') {
        for (const [word, total] of Object.entries(data.scores)) {
          const val = Number(total) || 0;
          scores.set(word, val);
          DEV_ECOSYSTEM_CACHE.set(word, val);
        }
        return scores;
      }
    } catch (_) {}
  }

  for (const word of toFetch) {
    let total = 0;
    try {
      const headers = { Accept: 'application/vnd.github.v3+json' };
      if (githubToken) headers.Authorization = 'token ' + githubToken;
      const ghResp = await fetch('https://api.github.com/search/repositories?q=' + encodeURIComponent(word) + '&per_page=1', { headers });
      if (ghResp.ok) {
        const ghData = await ghResp.json();
        total += Math.min(ghData.total_count || 0, 500000);
      }
    } catch (_) {}
    try {
      const npmResp = await fetch('https://registry.npmjs.org/-/v1/search?text=' + encodeURIComponent(word) + '&size=1');
      if (npmResp.ok) {
        const npmData = await npmResp.json();
        total += Math.min((npmData.total || 0) * 10, 100000);
      }
    } catch (_) {}
    scores.set(word, total);
    DEV_ECOSYSTEM_CACHE.set(word, total);
    await new Promise(r => setTimeout(r, 600));
  }
  return scores;
}

// ---------------------------------------------------------------------------
// API Enrichment: Wayback Machine archive check
// ---------------------------------------------------------------------------

async function checkArchiveHistory(domains) {
  const hits = new Set();
  if (!domains || domains.length === 0) return hits;
  const toCheck = domains.slice(0, 100);
  for (const domain of toCheck) {
    if (ARCHIVE_CACHE.has(domain)) { if (ARCHIVE_CACHE.get(domain)) hits.add(domain); continue; }
    try {
      const resp = await fetch('https://archive.org/wayback/available?url=' + encodeURIComponent(domain));
      if (resp.ok) {
        const data = await resp.json();
        const hasSnap = data.archived_snapshots && data.archived_snapshots.closest && data.archived_snapshots.closest.available;
        ARCHIVE_CACHE.set(domain, Boolean(hasSnap));
        if (hasSnap) hits.add(domain);
      } else {
        ARCHIVE_CACHE.set(domain, false);
      }
    } catch (_) {
      ARCHIVE_CACHE.set(domain, false);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return hits;
}

// ---------------------------------------------------------------------------
// API Enrichment: DataMuse word validation
// ---------------------------------------------------------------------------

async function enrichWithDataMuse(words) {
  const validated = new Map();
  if (!words || words.length === 0) return validated;
  const toCheck = [...new Set(words.filter(w => w.length >= 3))].slice(0, 50);
  for (const word of toCheck) {
    try {
      const resp = await fetch('https://api.datamuse.com/words?sp=' + encodeURIComponent(word) + '&md=f&max=1');
      if (resp.ok) {
        const data = await resp.json();
        if (data.length > 0 && data[0].word === word && data[0].tags) {
          const fTag = data[0].tags.find(t => t.startsWith('f:'));
          if (fTag) validated.set(word, parseFloat(fTag.slice(2)) || 0);
        }
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 50));
  }
  return validated;
}
