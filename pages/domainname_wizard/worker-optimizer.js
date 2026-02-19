// Domain Name Wizard - Optimizer (Thompson Sampling + UCB1 + Elite Replay)
// Depends on: worker-utils.js, worker-scoring.js

// ---------------------------------------------------------------------------
// Reward (multi-objective)
// ---------------------------------------------------------------------------

function scoreReward(rows, eliteSet) {
  if (!rows.length) return 0;
  const scores = rows.map((x) => x.overallScore || 0).sort((a, b) => b - a);
  const top = scores.slice(0, Math.min(5, scores.length));
  const avgTop = top.reduce((s, v) => s + v, 0) / top.length / 100;
  const novelty = eliteSet
    ? rows.filter((r) => !eliteSet.has(r.domain.toLowerCase())).length / Math.max(1, rows.length)
    : 0.5;
  const sylSet = new Set(rows.map((r) => r.syllableCount || 0));
  const diversity = sylSet.size / Math.min(5, rows.length);
  return round(clamp(avgTop * 0.60 + novelty * 0.25 + diversity * 0.15, 0, 1), 4);
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

class Optimizer {
  constructor(base, model, seed) {
    this.base = { ...base };
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
    ).slice(0, 40);
    if (!this._themeSeedTokens.length) this._themeSeedTokens = ['brand'];
    this._baseTokenSet = new Set(this._themeSeedTokens);
    this._themeSeedStems = new Set(this._themeSeedTokens.map(tokenStem).filter(Boolean));
    this._baseKeywordTokenSet = new Set(this._baseKeywordTokens);
    this._libraryTokenSet = new Set(this._libraryTokens);
    this._libraryPhraseTokenSet = new Set(this._libraryPhraseTokens);
    this._lockedSeedTokens = [];

    this._themeTokenScores = this._buildThemeTokenScores();
    this._themeTokenSet = new Set(this._themeTokenScores.keys());
    this._themeTokenPool = Array.from(this._themeTokenScores.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([token]) => token);

    this.curTokens = this._seedCurrentTokens();
    emitDebugLog('worker-optimizer.js', 'Initialized strict keyword pool', {
      seedTokens: this._themeSeedTokens.slice(0, 12),
      lockedTokens: this._lockedSeedTokens.slice(),
      curatedLibraryTokens: this._libraryTokens.slice(0, 20),
      curatedLibraryPhrases: (base.keywordLibraryPhrases || []).slice(0, 8),
      poolSize: this._themeTokenPool.length,
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
      if (next.length >= 8) break;
      add(token);
    }

    return next.slice(0, 8);
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
      if (next.length < 8) {
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
      if (next.length >= 8) break;
    }
  }

  _mutateAndReorder(next, intensity, lockedSet) {
    if (intensity !== 'high' || next.length <= Math.max(3, lockedSet.size + 1)) return;
    const locked = [];
    const mutable = [];
    for (const token of next) {
      if (lockedSet.has(token)) locked.push(token);
      else mutable.push(token);
    }
    mutable.sort(() => (this.rand() > 0.5 ? 1 : -1));
    next.length = 0;
    for (const token of locked.concat(mutable)) {
      if (!next.includes(token)) next.push(token);
      if (next.length >= 8) break;
    }
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
      const plays = Math.max(0, Math.floor(Number(stat.plays) || 0));
      const reward = Number(stat.reward) || 0;
      const avgReward = plays > 0 ? reward / plays : 0;
      const ucb = this.ucbScore(stat);
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
        plays,
        reward: round(reward, 4),
        avgReward: round(avgReward, 4),
        ucb: Number.isFinite(ucb) ? round(ucb, 4) : null,
        lastLoop: stat.lastLoop != null ? Number(stat.lastLoop) : null,
      });
    }

    rows.sort((a, b) => {
      if (a.inCurrentKeywords !== b.inCurrentKeywords) return a.inCurrentKeywords ? -1 : 1;
      if (a.plays !== b.plays) return b.plays - a.plays;
      if (a.avgReward !== b.avgReward) return b.avgReward - a.avgReward;
      if ((a.themeScore || 0) !== (b.themeScore || 0)) return (b.themeScore || 0) - (a.themeScore || 0);
      return a.token.localeCompare(b.token);
    });
    for (let i = 0; i < rows.length; i += 1) rows[i].rank = i + 1;
    return rows.slice(0, maxRows);
  }

  next(loop) {
    const explorationRate = Math.max(0.05, 0.35 * Math.pow(0.82, loop - 1));
    const styleOptions = this.base.preferEnglish !== false
      ? STYLE_VALUES.filter((value) => value !== 'nonenglish')
      : STYLE_VALUES;

    const style = this.rand() < explorationRate
      ? pick(styleOptions, this.rand)
      : this.thompsonChoose(this.model.style, styleOptions);
    const randomness = this.rand() < explorationRate
      ? pick(RANDOMNESS_VALUES, this.rand)
      : this.thompsonChoose(this.model.randomness, RANDOMNESS_VALUES);

    const tokenEntries = Object.entries(this.model.tokens).filter(([token]) => this._isThemeToken(token));
    const tokenRank = tokenEntries
      .map(([token, stat]) => ({ token, ucb: this.ucbScore(stat) }))
      .sort((a, b) => b.ucb - a.ucb);

    const good = tokenRank
      .filter((x) => x.ucb >= 0.58)
      .map((x) => x.token)
      .slice(0, 20);

    const weak = new Set(
      tokenRank
        .filter((x) => x.ucb <= 0.35 && (this.model.tokens[x.token] || {}).plays >= 3)
        .map((x) => x.token),
    );

    const baseTokens = this._baseKeywordTokens.length ? this._baseKeywordTokens.slice(0, 12) : this._themeSeedTokens.slice(0, 8);
    const anchorPool = this._themeTokenPool.slice(0, 60);
    const eliteTokens = this._collectEliteThemeTokens();

    const intensity = this.rand() < explorationRate ? 'high' : this.rand() > 0.5 ? 'medium' : 'low';
    const mut = intensity === 'high' ? 4 : intensity === 'medium' ? 2 : 1;
    const locked = this._lockedSeedTokens.slice();
    const lockedSet = new Set(locked);

    const next = [];
    for (const t of locked) if (!next.includes(t) && this._isThemeToken(t)) next.push(t);
    const carryBudget = Math.max(1, Math.min(4, Math.floor(2 + (1 - explorationRate) * 2)));
    for (const t of this.curTokens) {
      const clean = normalizeThemeToken(t);
      if (!clean || next.includes(clean) || !this._isThemeToken(clean)) continue;
      if (next.length >= carryBudget) break;
      next.push(clean);
      if (next.length >= 8) break;
    }
    if (!next.length) this._refillThemeTokens(next, baseTokens.concat(anchorPool));

    for (let i = 0; i < mut; i += 1) {
      this._removeOneMutable(next, weak, lockedSet);
      let src;
      const r = this.rand();
      if (good.length && r < 0.38) src = good;
      else if (anchorPool.length && r < 0.86) src = anchorPool;
      else if (eliteTokens.length && r < 0.96) src = eliteTokens;
      else src = baseTokens;
      const t = pick((src && src.length) ? src : baseTokens, this.rand);
      const clean = normalizeThemeToken(t);
      if (clean && !next.includes(clean) && this._isThemeToken(clean)) next.push(clean);
    }

    this._ensureLockedTokens(next, locked);
    this._refillThemeTokens(
      next,
      dedupeTokens(good.concat(anchorPool, eliteTokens, baseTokens, this._themeSeedTokens)),
    );
    this._mutateAndReorder(next, intensity, lockedSet);
    this._limitBaseSeedCarry(next, 1);
    this._refillThemeTokens(next, dedupeTokens(anchorPool.concat(good, eliteTokens, this._themeSeedTokens)));
    this._limitBaseSeedCarry(next, 1);

    this.curTokens = dedupeTokens(next.map(normalizeThemeToken).filter((t) => t && this._isThemeToken(t))).slice(0, 8);
    if (!this.curTokens.length) this.curTokens = baseTokens.slice(0, Math.min(8, baseTokens.length));

    emitDebugLog('worker-optimizer.js', 'Loop keyword selection', {
      loop,
      selectedKeywords: this.curTokens.slice(),
      poolSize: this._themeTokenPool.length,
    });

    return {
      loop,
      sourceLoop: this.bestLoop,
      explorationRate: round(explorationRate, 3),
      selectedStyle: style,
      selectedRandomness: randomness,
      selectedMutationIntensity: intensity,
      elitePoolSize: this.model.elitePool.length,
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

    for (const token of tokens) {
      if (!this.model.tokens[token]) this.model.tokens[token] = { plays: 0, reward: 0, lastLoop: null };
      this.model.tokens[token].plays += 1;
      this.model.tokens[token].reward += r;
      this.model.tokens[token].lastLoop = plan.loop;
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
    const a = pick(pool, rand);
    const b = pick(pool, rand);
    const c = pick(pool, rand);
    let sourceName = styleName(style, a, b, c, rand);
    if (plan.randomness === 'high' && rand() > 0.45) sourceName += pick(SUFFIX, rand);
    if (plan.randomness === 'low' && sourceName.length > 16) sourceName = sourceName.slice(0, 16);
    const label = toLabel(sourceName);
    if (!label || label.length > plan.maxLength) continue;
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
