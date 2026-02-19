// Domain Name Wizard - Scoring Engine
// Depends on: worker-utils.js (loaded first)

// ---------------------------------------------------------------------------
// Word segmentation and phonetic analysis
// ---------------------------------------------------------------------------

function estimateSyllables(label) {
  const parts = String(label || '').split('-').filter(Boolean);
  if (!parts.length) return 1;
  return parts.reduce((sum, part) => {
    const groups = part.match(/[aeiouy]+/g);
    return sum + Math.max(1, groups ? groups.length : 0);
  }, 0);
}

function segmentWords(label) {
  const clean = (label || '').replace(/[-0-9]/g, '').toLowerCase();
  if (!clean.length || !WORD_FREQ || WORD_FREQ.size === 0) {
    return { words: [], allParts: [], maxZipf: 0, totalZipf: 0, quality: 0 };
  }
  const n = clean.length;
  const dp = new Float64Array(n + 1).fill(-Infinity);
  const back = new Int32Array(n + 1).fill(-1);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 15); j < i; j++) {
      const w = clean.slice(j, i);
      const freq = WORD_FREQ.get(w);
      if (freq !== undefined && w.length >= 2) {
        const cappedFreq = w.length <= 2 ? Math.min(freq, 4.0) : w.length === 3 ? Math.min(freq, 4.5) : freq;
        const lengthBonus = Math.max(0, w.length - 2) * 2.5;
        const s = dp[j] + cappedFreq + lengthBonus;
        if (s > dp[i]) { dp[i] = s; back[i] = j; }
      }
    }
    if (dp[i - 1] - 3 > dp[i]) { dp[i] = dp[i - 1] - 3; back[i] = i - 1; }
  }
  const parts = [];
  let pos = n;
  while (pos > 0 && back[pos] >= 0) {
    parts.unshift(clean.slice(back[pos], pos));
    pos = back[pos];
  }
  if (pos > 0) parts.unshift(clean.slice(0, pos));
  const dictWords = parts.filter(w => WORD_FREQ.has(w) && w.length >= 2);
  const maxZipf = dictWords.length > 0 ? Math.max(...dictWords.map(w => WORD_FREQ.get(w))) : 0;
  const totalZipf = dictWords.reduce((s, w) => s + (WORD_FREQ.get(w) || 0), 0);
  const coverage = dictWords.reduce((s, w) => s + w.length, 0) / Math.max(1, n);
  return { words: dictWords, allParts: parts, maxZipf, totalZipf, quality: coverage };
}

function findMorphemes(label) {
  const seg = segmentWords(label);
  return seg.words;
}

function trigramScore(label) {
  const clean = (label || '').replace(/-/g, '').toLowerCase();
  if (!clean.length || !TRIGRAM_LM || TRIGRAM_LM.size === 0) return -2.0;
  const padded = '^' + clean + '$';
  let total = 0;
  let count = 0;
  for (let i = 0; i < padded.length - 2; i++) {
    const tri = padded.slice(i, i + 3);
    const lp = TRIGRAM_LM.get(tri);
    total += lp !== undefined ? lp : -3.0;
    count++;
  }
  return count > 0 ? total / count : -2.0;
}

// ---------------------------------------------------------------------------
// Sub-scorer: Phonetic Quality
// ---------------------------------------------------------------------------

function scorePhoneticQuality(label) {
  const drivers = [];
  const detractors = [];
  const clean = label.replace(/-/g, '').toLowerCase();
  if (!clean.length) return { score: 0, drivers, detractors };

  const triScore = trigramScore(clean);
  const triNorm = clamp((triScore + 2.0) * 50, 0, 100);
  if (triNorm >= 60) drivers.push({ component: 'Natural English sound', impact: round(triNorm * 0.3, 1) });
  if (triNorm < 25) detractors.push({ component: 'Unnatural sound', impact: round((25 - triNorm) * 0.3, 1) });

  let cv = '';
  for (const ch of clean) {
    if (VOWELS_SET.has(ch)) cv += 'V';
    else if (CONSONANTS_SET.has(ch)) cv += 'C';
  }
  let transitions = 0;
  for (let i = 1; i < cv.length; i++) if (cv[i] !== cv[i - 1]) transitions++;
  const altRatio = cv.length > 1 ? transitions / (cv.length - 1) : 0;
  const altScore = clamp(altRatio * 120, 0, 100);
  if (altScore >= 70) drivers.push({ component: 'Good CV flow', impact: round(altScore * 0.15, 1) });

  const vowelCount = (clean.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowelCount / clean.length;
  const vowelScore = clamp(100 - Math.abs(vowelRatio - 0.40) * 250, 0, 100);

  const score = clamp(triNorm * 0.50 + altScore * 0.30 + vowelScore * 0.20, 0, 100);
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Sub-scorer: Brandability
// ---------------------------------------------------------------------------

function scoreBrandability(label, keyTokens) {
  const drivers = [];
  const detractors = [];
  const clean = label.replace(/-/g, '').toLowerCase();
  if (!clean.length) return { score: 0, drivers, detractors };
  const len = clean.length;

  let ambiguityPenalty = 0;
  for (const [a, b] of AMBIGUOUS_PAIRS) {
    if (clean.includes(a) || clean.includes(b)) ambiguityPenalty += 8;
  }
  ambiguityPenalty = Math.min(ambiguityPenalty, 35);
  const visualClarity = 100 - ambiguityPenalty;
  if (ambiguityPenalty > 15) detractors.push({ component: 'Ambiguous chars', impact: round(ambiguityPenalty * 0.15, 1) });

  const syl = estimateSyllables(clean);
  const trochaic = syl >= 2 && syl <= 3;
  const rhythmScore = trochaic ? 100 : syl === 1 ? 75 : syl === 4 ? 60 : 40;
  if (trochaic) drivers.push({ component: 'Good rhythm', impact: round(rhythmScore * 0.15, 1) });

  const seg = segmentWords(clean);
  const wordQuality = seg.quality > 0.7 ? clamp(seg.maxZipf * 15, 0, 100) : seg.quality * 50;
  if (seg.maxZipf >= 4.5) drivers.push({ component: 'Common word parts', impact: round(wordQuality * 0.15, 1) });
  if (seg.quality < 0.2 && seg.words.length === 0) detractors.push({ component: 'No recognizable words', impact: 8.0 });

  let maxConcr = 0;
  if (CONCRETENESS_MAP) {
    for (const w of seg.words) {
      const c = CONCRETENESS_MAP.get(w) || 0;
      if (c > maxConcr) maxConcr = c;
    }
  }
  const concrScore = clamp(maxConcr * 20, 0, 100);
  if (maxConcr >= 4.0) drivers.push({ component: 'Concrete/visual word', impact: round(concrScore * 0.1, 1) });

  const lengthScore = clamp(100 - Math.abs(len - 8) * 9, 10, 100);
  if (len <= 6) drivers.push({ component: 'Short name', impact: round(lengthScore * 0.12, 1) });
  if (len >= 14) detractors.push({ component: 'Long name', impact: round((len - 13) * 5, 1) });

  const hyphenPen = label.includes('-') ? 20 : 0;
  const digitPen = /\d/.test(label) ? 25 : 0;
  if (hyphenPen) detractors.push({ component: 'Hyphen in name', impact: 4.0 });
  if (digitPen) detractors.push({ component: 'Digit in name', impact: 5.0 });

  let matches = 0;
  for (const token of keyTokens) if (clean.includes(token)) matches++;
  const relevance = keyTokens.length ? clamp(25 + (matches / keyTokens.length) * 75, 0, 100) : 30;
  if (matches > 0) drivers.push({ component: 'Keyword match', impact: round(relevance * 0.12, 1) });

  const charDiv = (new Set(clean.split('')).size / Math.max(1, len)) * 60;
  const score = clamp(
    visualClarity * 0.10 + rhythmScore * 0.13 + wordQuality * 0.20 +
    concrScore * 0.08 + lengthScore * 0.15 + relevance * 0.12 +
    (100 - hyphenPen) * 0.06 + (100 - digitPen) * 0.05 + charDiv * 0.05 +
    (trigramScore(clean) > -1.5 ? 6 : 0),
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Sub-scorer: SEO / Search Potential
// ---------------------------------------------------------------------------

function expandKeywords(keyTokens) {
  const expanded = new Set(keyTokens);
  for (const token of keyTokens) {
    const syns = BUSINESS_SYNONYMS[token];
    if (syns) for (const s of syns) expanded.add(s);
  }
  return expanded;
}

function scoreSeo(label, keyTokens, tld) {
  const drivers = [];
  const detractors = [];
  const clean = label.replace(/-/g, '').toLowerCase();
  if (!clean.length) return { score: 0, drivers, detractors };

  const seg = segmentWords(clean);
  const realWordScore = clamp(seg.quality * 130, 0, 100);
  if (seg.words.length >= 2) drivers.push({ component: 'Real word parts', impact: round(realWordScore * 0.25, 1) });
  if (seg.words.length === 0) detractors.push({ component: 'No recognizable words', impact: 8.0 });

  const expanded = expandKeywords(keyTokens);
  let kwHits = 0;
  for (const kw of expanded) {
    if (kw.length >= 3 && clean.includes(kw)) kwHits++;
  }
  const kwDensity = expanded.size > 0 ? clamp((kwHits / expanded.size) * 150, 0, 100) : 25;
  if (kwHits > 0) drivers.push({ component: 'Keyword/synonym match', impact: round(kwDensity * 0.15, 1) });

  let directMatch = 0;
  for (const token of keyTokens) if (clean.includes(token)) directMatch++;
  const directRel = keyTokens.length ? clamp(20 + (directMatch / keyTokens.length) * 80, 0, 100) : 25;

  const tldSeo = getTldTier(tld) * 100;
  if (tld === 'com') drivers.push({ component: '.com TLD', impact: 10.0 });
  if (tldSeo < 50) detractors.push({ component: 'Weak TLD for SEO', impact: round((50 - tldSeo) * 0.15, 1) });

  let maxConcr = 0;
  if (CONCRETENESS_MAP) {
    for (const w of seg.words) {
      const c = CONCRETENESS_MAP.get(w) || 0;
      if (c > maxConcr) maxConcr = c;
    }
  }
  const imageBonus = maxConcr >= 4.0 ? 12 : 0;
  if (maxConcr >= 4.0) drivers.push({ component: 'Concrete/visual word', impact: 3.0 });

  const score = clamp(
    realWordScore * 0.30 + kwDensity * 0.15 + directRel * 0.15 +
    tldSeo * 0.25 + imageBonus + (clean.length <= 12 ? 10 : 0) * 0.15,
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Sub-scorer: Commercial Value (CPC-based)
// ---------------------------------------------------------------------------

function scoreCommercialValue(label, tld) {
  const drivers = [];
  const detractors = [];
  const seg = segmentWords(label);

  let bestTier = 0;
  let bestWord = '';
  if (CPC_TIERS_MAP) {
    for (const w of seg.words) {
      const tier = CPC_TIERS_MAP.get(w);
      if (tier && (bestTier === 0 || tier < bestTier)) {
        bestTier = tier;
        bestWord = w;
      }
    }
  }

  const cpcScore = bestTier > 0 ? clamp((6 - bestTier) * 25, 0, 100) : 0;
  if (bestTier === 1) drivers.push({ component: 'Very high CPC keyword: ' + bestWord, impact: 25.0 });
  else if (bestTier === 2) drivers.push({ component: 'High CPC keyword: ' + bestWord, impact: 18.0 });
  else if (bestTier === 3) drivers.push({ component: 'Medium CPC keyword: ' + bestWord, impact: 10.0 });
  else if (bestTier === 0) detractors.push({ component: 'No commercial keyword', impact: 5.0 });

  const isSingleDict = seg.words.length === 1 && seg.quality >= 0.9;
  const categoryKiller = isSingleDict && seg.maxZipf >= 4.5 ? 30 : 0;
  if (categoryKiller > 0) drivers.push({ component: 'Category-killer domain', impact: 15.0 });

  const tldMult = getTldTier(tld);
  if (tld === 'com') drivers.push({ component: '.com premium', impact: 12.0 });
  if (tldMult < 0.3) detractors.push({ component: 'Low-value TLD', impact: round((0.3 - tldMult) * 20, 1) });

  const score = clamp(cpcScore * 0.40 + categoryKiller + tldMult * 40 * 0.30 + seg.quality * 30, 0, 100);
  return {
    score: round(score, 1), drivers, detractors,
    bestCpcTier: bestTier, bestCpcWord: bestWord,
    cpcScoreRaw: bestTier > 0 ? 6 - bestTier : 0,
    isCategoryKiller: categoryKiller > 0,
  };
}

// ---------------------------------------------------------------------------
// Sub-scorer: Memorability
// ---------------------------------------------------------------------------

function scoreMemorability(label) {
  const drivers = [];
  const detractors = [];
  const clean = label.replace(/-/g, '').toLowerCase();
  if (!clean.length) return { score: 0, drivers, detractors };
  const len = clean.length;
  const syl = estimateSyllables(clean);

  const chunkScore = clamp(100 - Math.max(0, syl - 3) * 18, 20, 100);
  if (syl <= 2) drivers.push({ component: 'Few syllables', impact: round(chunkScore * 0.15, 1) });
  if (syl >= 5) detractors.push({ component: 'Too many syllables', impact: round((syl - 4) * 8, 1) });

  let repeatBonus = 0;
  for (let i = 0; i < clean.length - 1; i++) if (clean[i] === clean[i + 1]) repeatBonus += 5;
  const bigramPairs = {};
  for (let i = 0; i < clean.length - 1; i++) {
    const bi = clean.slice(i, i + 2);
    bigramPairs[bi] = (bigramPairs[bi] || 0) + 1;
  }
  for (const count of Object.values(bigramPairs)) if (count >= 2) repeatBonus += 10;
  repeatBonus = Math.min(repeatBonus, 30);
  if (repeatBonus >= 10) drivers.push({ component: 'Pattern repetition', impact: round(repeatBonus * 0.12, 1) });

  const seg = segmentWords(clean);
  let maxConcr = 0;
  if (CONCRETENESS_MAP) {
    for (const w of seg.words) {
      const c = CONCRETENESS_MAP.get(w) || 0;
      if (c > maxConcr) maxConcr = c;
    }
  }
  const imageScore = maxConcr >= 3.5 ? 25 : maxConcr > 0 ? maxConcr * 5 : 0;
  if (maxConcr >= 4.0) drivers.push({ component: 'Visual/concrete word', impact: 5.0 });

  const wordFamiliarity = seg.maxZipf >= 5.0 ? 20 : seg.maxZipf >= 4.0 ? 12 : seg.maxZipf > 0 ? 5 : 0;
  if (seg.maxZipf >= 5.0) drivers.push({ component: 'Very common word', impact: round(wordFamiliarity * 0.3, 1) });

  const uniqueChars = new Set(clean.split('')).size;
  const simplicity = clamp(100 - Math.max(0, uniqueChars - 7) * 10, 20, 100);

  const recallLen = clamp(100 - Math.max(0, len - 7) * 8, 15, 100);
  if (len <= 6) drivers.push({ component: 'Easy to recall', impact: round(recallLen * 0.1, 1) });
  if (len >= 13) detractors.push({ component: 'Hard to recall', impact: round((len - 12) * 4, 1) });

  const score = clamp(
    chunkScore * 0.22 + repeatBonus * 0.08 + imageScore * 0.12 +
    wordFamiliarity * 0.12 + simplicity * 0.16 + recallLen * 0.30,
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Sub-scorer: Financial / Structural
// ---------------------------------------------------------------------------

function scoreFinancial(label, tld, price, available, yearlyBudget, definitive) {
  const drivers = [];
  const detractors = [];
  const clean = label.replace(/-/g, '').toLowerCase();
  const len = clean.length;

  const lengthVal = len <= 2 ? 100 : len <= 3 ? 95 : len <= 4 ? 90 : len <= 5 ? 82 :
    len <= 6 ? 70 : len <= 7 ? 58 : len <= 8 ? 46 : len <= 9 ? 36 :
    len <= 10 ? 28 : len <= 11 ? 22 : len <= 12 ? 17 : len <= 13 ? 13 :
    len <= 14 ? 10 : len <= 15 ? 8 : len <= 16 ? 6 : len <= 17 ? 5 :
    len <= 18 ? 4 : len <= 19 ? 3 : 2;
  if (len <= 5) drivers.push({ component: 'Short domain premium', impact: round(lengthVal * 0.15, 1) });
  if (len >= 12) detractors.push({ component: 'Long domain discount', impact: round((100 - lengthVal) * 0.1, 1) });

  const tldMult = getTldTier(tld) * 100;
  if (tld === 'com') drivers.push({ component: '.com premium', impact: 12.0 });

  const allAlpha = /^[a-z]+$/.test(clean);
  const hasDigit = /\d/.test(clean);
  const hasHyphen = label.includes('-');
  const charComp = allAlpha ? 100 : hasHyphen ? 30 : hasDigit ? 50 : 70;
  if (allAlpha) drivers.push({ component: 'Pure alpha', impact: 5.0 });
  if (hasHyphen) detractors.push({ component: 'Hyphen reduces value', impact: 7.0 });

  const seg = segmentWords(clean);
  const dictBonus = seg.words.some(w => w.length >= 4) ? 20 : 0;
  const singleWord = seg.words.length === 1 && seg.quality >= 0.9;
  const singleWordBonus = singleWord ? 25 : 0;
  if (singleWord) drivers.push({ component: 'Dictionary word domain', impact: 10.0 });

  let estimatedValue = (lengthVal * 0.35 + tldMult * 0.30 + charComp * 0.15 + dictBonus + singleWordBonus) * 0.8;

  let affordability = 50;
  if (typeof price === 'number' && Number.isFinite(price)) {
    affordability = clamp(110 - (price / Math.max(1, yearlyBudget)) * 60, 0, 100);
    if (price <= yearlyBudget * 0.5) drivers.push({ component: 'Well under budget', impact: round(affordability * 0.1, 1) });
    if (price > yearlyBudget) detractors.push({ component: 'Over budget', impact: round((price / yearlyBudget - 1) * 15, 1) });
  }

  const availScore = available ? 100 : 0;
  if (!available) detractors.push({ component: 'Not available', impact: 15.0 });
  const defScore = definitive ? 100 : 60;

  const score = clamp(
    availScore * 0.25 + affordability * 0.25 + estimatedValue * 0.01 * 20 +
    defScore * 0.08 + charComp * 0.07 + tldMult * 0.10 + lengthVal * 0.05,
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Comparable sales engine (k-nearest-neighbor)
// ---------------------------------------------------------------------------

function findComparables(features) {
  if (!SALES_COMPS || SALES_COMPS.length === 0) return { comps: [], medianPrice: 0 };

  const weights = { len: 3, tldTier: 5, maxZipf: 2, decompQuality: 3, wordCount: 2, cpcScore: 4 };
  const scored = SALES_COMPS.map(comp => {
    const dist =
      weights.len * Math.pow(Math.log10(Math.max(2, features.len)) - Math.log10(Math.max(2, comp.len)), 2) +
      weights.tldTier * Math.pow(features.tldTier - comp.tldTier, 2) +
      weights.maxZipf * Math.pow((features.maxZipf - comp.maxZipf) / 7, 2) +
      weights.decompQuality * Math.pow(features.decompQuality - comp.decompQuality, 2) +
      weights.wordCount * Math.pow(Math.min(features.wordCount, 3) - Math.min(comp.wordCount, 3), 2) +
      weights.cpcScore * Math.pow((features.cpcScore - comp.cpcScore) / 5, 2);
    return { ...comp, _dist: dist };
  });

  scored.sort((a, b) => a._dist - b._dist);
  const top5 = scored.slice(0, 5);
  const prices = top5.map(c => c.price).sort((a, b) => a - b);
  const medianPrice = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0;
  return { comps: top5.map(c => ({ label: c.label, tld: c.tld, price: c.price, year: c.year, similarity: round(1 / (1 + c._dist), 3) })), medianPrice };
}

// ---------------------------------------------------------------------------
// Market value regression
// ---------------------------------------------------------------------------

function estimateValueUSD(features) {
  const w = MODEL_WEIGHTS || {};
  const logPrice =
    (w.intercept || 1.8) +
    (w.logLength || -2.5) * Math.log10(Math.max(2, features.len)) +
    (w.tldTier || 1.2) * features.tldTier +
    (w.maxWordZipf || 0.3) * features.maxZipf +
    (w.decompQuality || 0.5) * features.decompQuality +
    (w.wordCount || -0.2) * Math.min(features.wordCount, 3) +
    (w.cpcScore || 0.15) * features.cpcScore +
    (w.singleDictWord || 0.5) * (features.singleDictWord ? 1 : 0) +
    (w.hyphenPenalty || -0.5) * (features.hasHyphen ? 1 : 0) +
    (w.digitPenalty || -0.3) * (features.hasDigit ? 1 : 0) +
    (features.devEcosystemScore > 0 ? 0.1 * Math.log10(1 + features.devEcosystemScore) : 0) +
    (features.archiveHistory ? 0.3 : 0);

  const rmse = w._rmse || 0.8;
  const estimated = Math.pow(10, logPrice);
  const low = Math.pow(10, logPrice - rmse);
  const high = Math.pow(10, logPrice + rmse);

  return {
    estimated: Math.round(estimated),
    low: Math.round(low),
    high: Math.round(high),
    logPrice: round(logPrice, 3),
    confidence: rmse <= 0.7 ? 'high' : rmse <= 1.0 ? 'medium' : 'low',
  };
}

// ---------------------------------------------------------------------------
// Expected Value & Liquidity
// ---------------------------------------------------------------------------

function calculateEV(estimatedValue, askingPrice, tld, features) {
  const lp = LIQUIDITY_PARAMS || {};
  const tldLiq = (lp.tldLiquidity || {})[tld] || 0.15;

  let bracket = 'over100000';
  if (estimatedValue < 100) bracket = 'under100';
  else if (estimatedValue < 500) bracket = 'under500';
  else if (estimatedValue < 1000) bracket = 'under1000';
  else if (estimatedValue < 5000) bracket = 'under5000';
  else if (estimatedValue < 10000) bracket = 'under10000';
  else if (estimatedValue < 50000) bracket = 'under50000';
  else if (estimatedValue < 100000) bracket = 'under100000';
  const bracketVelocity = ((lp.priceBracketVelocity || {})[bracket]) || 0.15;

  const wordBonus = features.decompQuality > 0.8 ? 1.3 : features.decompQuality > 0.5 ? 1.1 : 0.9;
  const baseSaleProb = lp.baseSaleProbability24m || 0.18;
  const saleProbability24m = clamp(baseSaleProb * tldLiq * (1 + bracketVelocity) * wordBonus, 0.01, 0.85);
  const saleProbability12m = saleProbability24m * 0.55;
  const saleProbability36m = clamp(saleProbability24m * 1.4, 0, 0.92);

  const annualCost = ((lp.annualRenewalCost || {})[tld]) || 15;
  const holdingCost24m = annualCost * 2;

  const ev24m = saleProbability24m * estimatedValue - holdingCost24m;
  const roi = typeof askingPrice === 'number' && askingPrice > 0
    ? round((ev24m - askingPrice) / askingPrice * 100, 1)
    : null;

  const liquidityScore = round(clamp(
    tldLiq * 35 + bracketVelocity * 120 + (features.decompQuality > 0.7 ? 20 : 5) +
    (features.maxZipf > 4.5 ? 10 : 0),
    0, 100
  ), 1);

  const timeToSaleMonths = liquidityScore > 60 ? 12 : liquidityScore > 35 ? 24 : 36;

  return {
    saleProbability12m: round(saleProbability12m, 3),
    saleProbability24m: round(saleProbability24m, 3),
    saleProbability36m: round(saleProbability36m, 3),
    ev24m: Math.round(ev24m),
    expectedROI: roi,
    holdingCost24m,
    liquidityScore,
    timeToSaleMonths,
  };
}

// ---------------------------------------------------------------------------
// Composite: scoreDomain
// ---------------------------------------------------------------------------

function scoreDomain(row, input, enrichment) {
  const parts = row.domain.split('.');
  const label = parts[0] || '';
  const tld = parts.slice(1).join('.') || input.tld;
  const len = label.length;
  const syl = estimateSyllables(label);
  const keyTokens = tokenize(input.keywords + ' ' + input.description);
  const enrich = enrichment || {};

  const phonetic = scorePhoneticQuality(label);
  const brand = scoreBrandability(label, keyTokens);
  const seo = scoreSeo(label, keyTokens, tld);
  const commercial = scoreCommercialValue(label, tld);
  const financial = scoreFinancial(label, tld, row.price, row.available, input.yearlyBudget, row.definitive);
  const memo = scoreMemorability(label);

  const seg = segmentWords(label);
  const tldTier = getTldTier(tld);
  const clean = label.replace(/-/g, '').toLowerCase();

  const features = {
    len: clean.length,
    tldTier,
    maxZipf: seg.maxZipf,
    decompQuality: seg.quality,
    wordCount: seg.words.length,
    cpcScore: commercial.cpcScoreRaw || 0,
    singleDictWord: seg.words.length === 1 && seg.quality >= 0.9,
    hasHyphen: label.includes('-'),
    hasDigit: /\d/.test(label),
    devEcosystemScore: enrich.devEcosystemScore || 0,
    archiveHistory: Boolean(enrich.archiveHistory),
    phoneticScore: phonetic.score,
  };

  const comps = findComparables(features);
  const valuation = estimateValueUSD(features);
  const evData = calculateEV(valuation.estimated, row.price, tld, features);

  const valueRatio = typeof row.price === 'number' && row.price > 0
    ? round(valuation.estimated / row.price, 2) : null;

  let underpricedFlag = null;
  if (valueRatio !== null) {
    if (valueRatio >= 10) underpricedFlag = 'STRONGLY_UNDERPRICED';
    else if (valueRatio >= 3) underpricedFlag = 'UNDERPRICED';
  }

  const marketabilityScore = round(clamp(
    phonetic.score * 0.18 + brand.score * 0.35 + seo.score * 0.22 + memo.score * 0.25,
    0, 100), 1);
  const financialValueScore = round(clamp(financial.score, 0, 100), 1);

  const intrinsicValue = round(clamp(
    phonetic.score * 0.15 + brand.score * 0.25 + seo.score * 0.15 +
    commercial.score * 0.20 + memo.score * 0.15 +
    (seg.quality > 0.7 ? 10 : 0),
    0, 100), 1);

  const overallScore = round(clamp(intrinsicValue, 0, 100), 1);

  const valueDrivers = [].concat(
    phonetic.drivers, brand.drivers, seo.drivers, commercial.drivers, financial.drivers, memo.drivers
  ).sort((a, b) => b.impact - a.impact).slice(0, 5);

  const valueDetractors = [].concat(
    phonetic.detractors, brand.detractors, seo.detractors, commercial.detractors, financial.detractors, memo.detractors
  ).sort((a, b) => b.impact - a.impact).slice(0, 5);

  return {
    marketabilityScore,
    financialValueScore,
    overallScore,
    intrinsicValue,
    phoneticScore: phonetic.score,
    brandabilityScore: brand.score,
    seoScore: seo.score,
    commercialScore: commercial.score,
    memorabilityScore: memo.score,
    syllableCount: syl,
    labelLength: len,
    estimatedValueUSD: valuation.estimated,
    estimatedValueLow: valuation.low,
    estimatedValueHigh: valuation.high,
    valueConfidence: valuation.confidence,
    valueRatio,
    underpricedFlag,
    liquidityScore: evData.liquidityScore,
    timeToSaleMonths: evData.timeToSaleMonths,
    saleProbability24m: evData.saleProbability24m,
    ev24m: evData.ev24m,
    expectedROI: evData.expectedROI,
    comparableSales: comps.comps,
    comparableMedianPrice: comps.medianPrice,
    devEcosystemScore: enrich.devEcosystemScore || 0,
    hasArchiveHistory: Boolean(enrich.archiveHistory),
    segmentedWords: seg.words,
    valueDrivers,
    valueDetractors,
  };
}

// ---------------------------------------------------------------------------
// Sort & Merge
// ---------------------------------------------------------------------------

function sortRanked(rows, mode) {
  const out = (rows || []).slice();
  out.sort((a, b) => {
    if (mode === 'financialValue') return (b.financialValueScore || 0) - (a.financialValueScore || 0) || (b.overallScore || 0) - (a.overallScore || 0) || String(a.domain).localeCompare(String(b.domain));
    if (mode === 'intrinsicValue') return (b.intrinsicValue || 0) - (a.intrinsicValue || 0) || (b.overallScore || 0) - (a.overallScore || 0) || String(a.domain).localeCompare(String(b.domain));
    if (mode === 'estimatedValue') return (b.estimatedValueUSD || 0) - (a.estimatedValueUSD || 0) || (b.overallScore || 0) - (a.overallScore || 0) || String(a.domain).localeCompare(String(b.domain));
    if (mode === 'valueRatio') return (b.valueRatio || 0) - (a.valueRatio || 0) || (b.estimatedValueUSD || 0) - (a.estimatedValueUSD || 0) || String(a.domain).localeCompare(String(b.domain));
    if (mode === 'expectedValue') return (b.ev24m || 0) - (a.ev24m || 0) || (b.estimatedValueUSD || 0) - (a.estimatedValueUSD || 0) || String(a.domain).localeCompare(String(b.domain));
    if (mode === 'liquidityScore') return (b.liquidityScore || 0) - (a.liquidityScore || 0) || (b.overallScore || 0) - (a.overallScore || 0) || String(a.domain).localeCompare(String(b.domain));
    if (mode === 'devEcosystem') return (b.devEcosystemScore || 0) - (a.devEcosystemScore || 0) || (b.overallScore || 0) - (a.overallScore || 0) || String(a.domain).localeCompare(String(b.domain));
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
  return {
    ...chosen,
    firstSeenLoop: Math.min(existing.firstSeenLoop || loop, next.firstSeenLoop || loop),
    lastSeenLoop: loop,
    timesDiscovered: (existing.timesDiscovered || 1) + 1,
  };
}
