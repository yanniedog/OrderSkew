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

// ---------------------------------------------------------------------------
// Optimizer (Thompson Sampling + UCB1 + Elite Replay + Feature Learning)
// ---------------------------------------------------------------------------

class Optimizer {
  constructor(base, model, seed) {
    this.base = { ...base };
    this.model = sanitizeModel(model);
    this.rand = rng(seed || now());
    this.curTokens = tokenize(`${base.keywords} ${base.description}`).slice(0, 8);
    this.bestLoop = undefined;
    this.bestReward = -1;
    this.eliteSet = new Set(this.model.elitePool.map(e => e.domain.toLowerCase()));
    this.totalPlays = Object.values(this.model.tokens).reduce((s, t) => s + t.plays, 0) || 1;

    this._baseTokenSet = new Set(tokenize(`${base.keywords} ${base.description}`));

    if (WORD_FREQ && WORD_FREQ.size > 0) {
      const toDelete = [];
      for (const [token] of Object.entries(this.model.tokens)) {
        if (this._baseTokenSet.has(token)) continue;
        if (!isValidToken(token)) toDelete.push(token);
      }
      if (toDelete.length > 0) {
        emitDebugLog('worker-optimizer.js', 'Pruned junk tokens from persisted model', {
          prunedCount: toDelete.length,
          prunedSample: toDelete.slice(0, 20),
          remainingCount: Object.keys(this.model.tokens).length - toDelete.length,
        });
        for (const t of toDelete) delete this.model.tokens[t];
      }
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

  _buildSynonymPool() {
    const expanded = [];
    for (const bt of this._baseTokenSet) {
      const syns = BUSINESS_SYNONYMS[bt];
      if (syns) {
        for (const s of syns) {
          if (s.length >= 3 && !expanded.includes(s)) expanded.push(s);
        }
      }
    }
    return expanded;
  }

  next(loop) {
    const explorationRate = Math.max(0.05, 0.35 * Math.pow(0.82, loop - 1));

    const style = this.rand() < explorationRate
      ? pick(STYLE_VALUES, this.rand)
      : this.thompsonChoose(this.model.style, STYLE_VALUES);
    const randomness = this.rand() < explorationRate
      ? pick(RANDOMNESS_VALUES, this.rand)
      : this.thompsonChoose(this.model.randomness, RANDOMNESS_VALUES);

    const tokenEntries = Object.entries(this.model.tokens);
    const tokenRank = tokenEntries
      .map(([token, stat]) => ({ token, ucb: this.ucbScore(stat) }))
      .sort((a, b) => b.ucb - a.ucb);

    const good = tokenRank
      .filter((x) => x.ucb >= 0.6)
      .filter((x) => this._baseTokenSet.has(x.token) || isValidToken(x.token))
      .map((x) => x.token)
      .slice(0, 15);

    const weak = new Set(
      tokenRank
        .filter((x) => x.ucb <= 0.35 && (this.model.tokens[x.token] || {}).plays >= 3)
        .map((x) => x.token)
    );

    const baseTokens = tokenize(this.base.keywords).slice(0, 12);

    const eliteTokens = [];
    for (const elite of this.model.elitePool.slice(0, 10)) {
      const label = elite.domain.split('.')[0] || '';
      const morphemes = findMorphemes(label);
      for (const m of morphemes) {
        if (m.length >= 3 && !eliteTokens.includes(m)) eliteTokens.push(m);
      }
      if (label.includes('-')) {
        for (const part of label.split('-').filter(Boolean)) {
          if (part.length >= 3 && isValidToken(part) && !eliteTokens.includes(part)) {
            eliteTokens.push(part);
          }
        }
      }
    }

    const synonymPool = this._buildSynonymPool();

    const intensity = this.rand() < explorationRate ? 'high' : this.rand() > 0.5 ? 'medium' : 'low';
    const mut = intensity === 'high' ? 4 : intensity === 'medium' ? 2 : 1;
    const next = this.curTokens.length ? this.curTokens.slice() : baseTokens.slice(0, 4);

    for (let i = 0; i < mut; i += 1) {
      if (next.length > 2) {
        const weakIdx = next.findIndex((t) => weak.has(t));
        const idx = weakIdx >= 0 ? weakIdx : Math.floor(this.rand() * next.length);
        next.splice(idx, 1);
      }
      let src;
      const r = this.rand();
      if (eliteTokens.length && r < 0.25) {
        src = eliteTokens;
      } else if (good.length && r < 0.55) {
        src = good;
      } else if (synonymPool.length && r < 0.75) {
        src = synonymPool;
      } else {
        src = baseTokens;
      }
      const t = pick(src.length ? src : baseTokens, this.rand);
      if (t && !next.includes(t)) next.push(t);
    }

    this.curTokens = next.slice(0, 8);

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/0500be7a-802e-498d-b34c-96092e89bf3b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f925fd'},body:JSON.stringify({sessionId:'f925fd',location:'worker-optimizer.js:Optimizer.next',message:'Keyword generation',data:{loop,curTokens:this.curTokens.slice(),keywordsString:this.curTokens.join(' ')||this.base.keywords,eliteTokens:eliteTokens.slice(0,10),goodTokens:good.slice(0,10),synonymsUsed:synonymPool.slice(0,10),style,randomness,intensity},timestamp:Date.now(),runId:'run1',hypothesisId:'H1_fix'})}).catch(function(){});
    // #endregion

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

    const tokens = tokenize(`${plan.input.keywords} ${plan.input.description}`)
      .filter(t => this._baseTokenSet.has(t) || isValidToken(t))
      .slice(0, 12);
    for (const token of tokens) {
      if (!this.model.tokens[token]) this.model.tokens[token] = { plays: 0, reward: 0 };
      this.model.tokens[token].plays += 1;
      this.model.tokens[token].reward += r;
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

        const existing = this.model.elitePool.find(e => e.domain.toLowerCase() === dom.domain.toLowerCase());
        if (existing) {
          if ((dom.overallScore || 0) > existing.score) existing.score = dom.overallScore || 0;
        } else {
          this.model.elitePool.push({ domain: dom.domain, score: dom.overallScore || 0 });
        }
      }
      this.model.elitePool.sort((a, b) => b.score - a.score);
      this.model.elitePool = this.model.elitePool.slice(0, 30);
      this.eliteSet = new Set(this.model.elitePool.map(e => e.domain.toLowerCase()));
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
        .filter(([token]) => this._baseTokenSet.has(token) || isValidToken(token))
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
