const STYLE_VALUES = ['default', 'brandable', 'twowords', 'threewords', 'compound', 'spelling', 'nonenglish', 'dictionary'];
const RANDOMNESS_VALUES = ['low', 'medium', 'high'];
const LOOP_LIMIT = 251;
const MAX_STALL = 3;
const MAX_BATCH = 12;

const DB_NAME = 'domainname-wizard-browser';
const STORE = 'kv';
const MODEL_KEY = 'optimizer_v2';

const jobs = new Map();
const canceled = new Set();
let dbPromise = null;

const PREFIX = ['neo', 'prime', 'terra', 'ultra', 'atlas', 'delta', 'signal', 'lumen', 'forge', 'orbit'];
const SUFFIX = ['labs', 'works', 'base', 'flow', 'stack', 'hub', 'gen', 'pilot', 'ly', 'io'];
const DICT = ['horizon', 'ember', 'vector', 'harbor', 'beacon', 'origin', 'summit', 'apex'];

// ---------------------------------------------------------------------------
// Scoring data tables
// ---------------------------------------------------------------------------

const BIGRAM_FREQ = {
  th:87,he:78,in:72,er:67,an:63,re:57,on:56,at:51,en:51,nd:50,
  ti:50,es:49,or:47,te:46,of:44,ed:43,is:42,it:41,al:40,ar:39,
  st:38,to:37,nt:37,ng:36,se:35,ha:34,as:32,ou:32,io:31,le:31,
  ve:31,co:30,me:30,de:30,hi:29,ri:29,ro:29,ic:28,ne:27,ea:27,
  ra:26,ce:26,li:25,ch:25,ll:24,be:24,ma:23,si:23,om:22,ur:22,
  ca:21,el:21,ta:21,la:20,ns:20,ge:19,ly:19,wi:19,no:19,ol:18,
  ut:18,ad:17,di:17,wa:17,pe:17,na:17,tr:16,ec:16,ni:16,pr:16,
  ct:16,sp:15,ac:15,ot:15,il:15,us:15,em:14,op:14,fo:14,ow:14,
  ag:14,id:13,un:13,pl:13,up:13,po:13,sh:13,ts:13,bl:12,ab:12,
  pa:12,fi:12,oo:12,ig:12,ty:11,ss:11,cr:11,iv:11,am:11,ho:11
};
const BIGRAM_MAX = 87;

const HARD_CLUSTERS = new Set([
  'bz','cbd','cg','cz','dk','dz','fb','fg','fk','fn','fp','fz',
  'gd','gf','gk','gm','gp','gz','hk','hz','jb','jd','jf','jg',
  'jk','jl','jm','jn','jp','jq','jr','jt','jv','jw','jx','jz',
  'kb','kd','kf','kg','kj','kp','kq','kv','kz','lb','lf','lg',
  'lk','lp','lq','lv','lz','mb','md','mf','mg','mk','mp','mq',
  'mv','mz','nb','nf','ng','nk','nm','np','nq','nv','nz','pb',
  'pd','pf','pg','pk','pm','pn','pq','pv','pw','pz','qb','qd',
  'qf','qg','qk','qm','qp','qv','qw','qx','qz','rq','rz','sb',
  'sd','sf','sg','sj','sz','tb','td','tf','tg','tj','tz','vb',
  'vd','vf','vg','vk','vm','vn','vp','vq','vr','vt','vw','vz',
  'wb','wd','wf','wg','wk','wm','wp','wq','wv','wz','xb','xd',
  'xf','xg','xj','xk','xm','xn','xq','xr','xw','xz','zb','zd',
  'zf','zg','zk','zm','zn','zp','zq','zr','zv','zw','zx'
]);

const MORPHEMES = new Set(
  'able ace act add age aid aim air all amp app apt arc art auto back band bank bar base bay beam beat bell best big bio bit blast blaze block bloom blue bold bolt bond boom boost born box brand brave break brew bridge bright bring broad build bulk burn burst buzz call calm camp care cart cast chain change charge chart check chief chip choice city claim class clean clear click climb clip clock close cloud club clue coach code cold color come cool copy core cost craft crave crew cross crown crush cube cure curve cut cyber dash data dawn deal deck deep delta demo design dev dial dig direct disc dock dose down draft draw dream drift drive drop drum dual dusk dust dyna early earth east echo edge elite ember end energy era ever exact exit face fact fair fame fast fault feed field fill film find fine fire firm first fit five flash flat flex flip float flock flow flux focus fold font force forge form fort found fox frame free fresh front fuel full fund fuse gain gate gear gem ghost gift glow goal gold good grab grade grand graph grasp green grid grip group grow guide hack half hand hard hat haven head heal heap heart heat help hero high hike hint hold home hook hope host hub hunt idea impact index info ink input iron isle jade jet join jump just keen keep key kind king kit knit know lab lake lamp land lane laser last launch law layer lead leaf lean leap learn lens let level lever life lift light lime line link lion list live load lock logic long look loop loud love luck lumen luna lux made magic main make map mark mass master match mate maze media meet meld merge mesh metal mind mine mint mix mode model mold moon more motion mount move much muse name native near nest net new next node north note nova null oak one open opera orbit order origin outer over pace pack page pair palm park parse pass past path pave peak pen pick pilot pine pixel plan plant play plot plug plus point polar pole poll pond pool pop port post pour power press price prime print prize probe profit proof proto pulse pump pure push quad quest quick quote race radar rail raise range rank rapid rate raw ray reach read real reef reel rest rich ride ridge rift ring rise risk river road rock role roll roof root rope rose round route rover rule rush safe sage sail salt sand save scale scan scene scope score scout sea seal search seed self sense serve set shade shape share sharp shed shift shine ship shore short show side sign silk simple site size skill skip sky slice slim slot smart snap solar sole solve sonic sort soul sound source south space span spark spec speed sphere spin spot spring squad stack stage stamp stand star start state stay steam steel step stock stone store storm street strike strip strong style sum sun super surge swift sync table talk tank tap target task team tech tempo tend term terra test theme thick tide tight time titan tone tool top torch total touch tower trace track trade trail train trend tribe trick trim true trust tube tune turn twist type ultra union unit urban use vale value vault vector vein vent verse view vigor vine vision visit vista vital vivid voice void volt vortex vote wake walk wall want ward warm watch wave way wealth web well west wide wild win wind wire wise wolf wonder wood word work world worth yard year yield zen zero zone'.split(' ')
);

const IMAGEABLE_WORDS = new Set(
  'air anchor apple arrow badge ball banner basket beam bear bell bird blade blaze bolt bone book bow box bridge bull cage castle chain clock cloud coat coin compass crown crystal cup dart deer diamond door dragon drum eagle egg eye falcon feather fire fish flag flame flower forest fox gate gem ghost globe gold hammer harbor hawk heart hill horn horse ice island jade jewel key king knight lake lamp leaf lighthouse lion lock lotus map mask mirror moon mountain nest oak ocean owl palm pearl phoenix pine planet plume pulse rain raven reef ring river rock root rose sail sand sea seed shadow shell shield ship silk silver skull sky snake snow spark sphere star stone storm sun swan sword temple thunder tiger torch tower tree turtle vine volcano wall water wave whale wheel wind wing wolf'.split(' ')
);

const TLD_SEO_FACTOR = {
  com: 1.0, org: 0.92, net: 0.88, io: 0.90, ai: 0.93, co: 0.87,
  app: 0.89, dev: 0.88, tech: 0.85, xyz: 0.78, me: 0.82, info: 0.80,
  biz: 0.76, us: 0.81, uk: 0.83, de: 0.82, ca: 0.82, au: 0.81,
  store: 0.79, shop: 0.79, cloud: 0.84, design: 0.82, online: 0.77,
  site: 0.76, space: 0.78, world: 0.77, pro: 0.83, tools: 0.80
};

const TLD_VALUE_MULT = {
  com: 1.0, ai: 0.85, io: 0.70, co: 0.55, net: 0.40, org: 0.42,
  app: 0.45, dev: 0.40, tech: 0.30, xyz: 0.12, me: 0.25, info: 0.15,
  biz: 0.10, pro: 0.20, cloud: 0.22, design: 0.18
};

const LENGTH_VALUE_CURVE = {
  2: 100, 3: 95, 4: 90, 5: 82, 6: 70, 7: 58, 8: 46, 9: 36,
  10: 28, 11: 22, 12: 17, 13: 13, 14: 10, 15: 8, 16: 6, 17: 5,
  18: 4, 19: 3, 20: 2
};

const AMBIGUOUS_PAIRS = [
  ['l', '1'], ['l', 'i'], ['0', 'o'], ['m', 'rn'],
  ['vv', 'w'], ['cl', 'd'], ['nn', 'm']
];

const BUSINESS_SYNONYMS = {
  ai: ['artificial','intelligence','smart','machine','learn','neural','auto'],
  tech: ['technology','digital','software','hardware','code','compute','cyber'],
  cloud: ['server','host','deploy','saas','infra','platform','scale'],
  data: ['analytics','insight','metric','warehouse','pipeline','lake','stream'],
  web: ['internet','online','site','browser','http','app','portal'],
  app: ['application','mobile','software','tool','program','service','utility'],
  health: ['medical','wellness','care','fit','bio','vital','cure'],
  finance: ['money','bank','pay','invest','fund','capital','trade'],
  market: ['commerce','sell','buy','shop','store','retail','brand'],
  learn: ['education','study','teach','course','skill','tutor','academy'],
  build: ['construct','create','make','craft','forge','develop','design'],
  fast: ['quick','rapid','speed','swift','instant','turbo','flash'],
  secure: ['safe','protect','guard','shield','trust','vault','lock'],
  connect: ['link','network','bridge','sync','join','unite','mesh'],
  green: ['eco','sustain','clean','renew','solar','earth','nature'],
  creative: ['design','art','craft','studio','canvas','pixel','media'],
  productivity: ['workflow','task','manage','plan','organize','track','focus']
};

const VOWELS_SET = new Set('aeiouy'.split(''));
const CONSONANTS_SET = new Set('bcdfghjklmnpqrstvwxz'.split(''));

// ---------------------------------------------------------------------------
// Core utilities
// ---------------------------------------------------------------------------

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

function sendIngest(location, message, data, hypothesisId) {
  const payload = { sessionId: 'efbcb6', location: String(location || 'engine.worker.js'), message: String(message || 'log'), data: data || {}, timestamp: Date.now(), runId: 'run1', hypothesisId: hypothesisId || null };
  self.postMessage({ type: 'debugLog', payload: payload });
  fetch('http://127.0.0.1:7244/ingest/0500be7a-802e-498d-b34c-96092e89bf3b', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'efbcb6' }, body: JSON.stringify(payload) }).catch(function () {});
}

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

// ---------------------------------------------------------------------------
// Sub-scorer: Phonetic Quality
// ---------------------------------------------------------------------------

function cvPattern(label) {
  let pattern = '';
  for (const ch of label) {
    if (VOWELS_SET.has(ch)) pattern += 'V';
    else if (CONSONANTS_SET.has(ch)) pattern += 'C';
  }
  return pattern;
}

function scorePhoneticQuality(label) {
  const drivers = [];
  const detractors = [];
  const clean = label.replace(/-/g, '').toLowerCase();
  if (!clean.length) return { score: 0, drivers, detractors };

  const cv = cvPattern(clean);
  let transitions = 0;
  for (let i = 1; i < cv.length; i++) {
    if (cv[i] !== cv[i - 1]) transitions++;
  }
  const altRatio = cv.length > 1 ? transitions / (cv.length - 1) : 0;
  const altScore = clamp(altRatio * 120, 0, 100);
  if (altScore >= 70) drivers.push({ component: 'CV alternation', impact: round(altScore * 0.3, 1) });
  if (altScore < 40) detractors.push({ component: 'Poor CV flow', impact: round((40 - altScore) * 0.3, 1) });

  let clusterPenalty = 0;
  for (let i = 0; i < clean.length - 1; i++) {
    const bi = clean.slice(i, i + 2);
    if (HARD_CLUSTERS.has(bi)) clusterPenalty += 18;
  }
  clusterPenalty = Math.min(clusterPenalty, 60);
  if (clusterPenalty > 15) detractors.push({ component: 'Hard clusters', impact: round(clusterPenalty * 0.25, 1) });

  let bigramSum = 0;
  let bigramCount = 0;
  for (let i = 0; i < clean.length - 1; i++) {
    const bi = clean.slice(i, i + 2);
    bigramSum += (BIGRAM_FREQ[bi] || 0) / BIGRAM_MAX;
    bigramCount++;
  }
  const bigramAvg = bigramCount > 0 ? (bigramSum / bigramCount) * 100 : 30;
  if (bigramAvg >= 40) drivers.push({ component: 'Natural letter flow', impact: round(bigramAvg * 0.2, 1) });

  const vowelCount = (clean.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowelCount / clean.length;
  const vowelScore = clamp(100 - Math.abs(vowelRatio - 0.40) * 250, 0, 100);

  const score = clamp(
    altScore * 0.30 + (100 - clusterPenalty) * 0.25 + bigramAvg * 0.25 + vowelScore * 0.20,
    0, 100
  );
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

  let alliterationBonus = 0;
  const words = label.split('-').filter(Boolean);
  if (words.length >= 2) {
    const initials = words.map(w => w[0]);
    if (new Set(initials).size < initials.length) alliterationBonus = 20;
  }
  const vowelGroups = clean.match(/[aeiouy]+/g) || [];
  let assonanceBonus = 0;
  if (vowelGroups.length >= 2) {
    const vs = vowelGroups.map(g => g[0]);
    if (new Set(vs).size < vs.length) assonanceBonus = 15;
  }
  const soundRepeat = Math.min(alliterationBonus + assonanceBonus, 30);
  if (soundRepeat >= 15) drivers.push({ component: 'Sound repetition', impact: round(soundRepeat * 0.1, 1) });

  const phonemes = new Set(clean.split('')).size;
  const cogLoad = clamp(100 - Math.max(0, phonemes - 8) * 8, 30, 100);

  let bigramTotal = 0;
  for (let i = 0; i < clean.length - 1; i++) {
    bigramTotal += (BIGRAM_FREQ[clean.slice(i, i + 2)] || 0) / BIGRAM_MAX;
  }
  const avgBigram = len > 1 ? bigramTotal / (len - 1) : 0.3;
  const uniqueness = clamp((1 - avgBigram) * 130, 0, 100);
  if (uniqueness >= 60) drivers.push({ component: 'Distinctive spelling', impact: round(uniqueness * 0.1, 1) });

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

  const score = clamp(
    visualClarity * 0.12 +
    rhythmScore * 0.15 +
    soundRepeat * 0.08 +
    cogLoad * 0.10 +
    uniqueness * 0.10 +
    lengthScore * 0.15 +
    relevance * 0.14 +
    (100 - hyphenPen) * 0.06 +
    (100 - digitPen) * 0.05 +
    (new Set(clean.split('')).size / Math.max(1, len)) * 60 * 0.05,
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Sub-scorer: SEO / Search Potential
// ---------------------------------------------------------------------------

function findMorphemes(label) {
  const clean = label.replace(/-/g, '').toLowerCase();
  const found = [];
  for (const m of MORPHEMES) {
    if (m.length >= 3 && clean.includes(m)) found.push(m);
  }
  found.sort((a, b) => b.length - a.length);
  return found;
}

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

  const morphs = findMorphemes(clean);
  const morphCoverage = morphs.reduce((s, m) => s + m.length, 0) / Math.max(1, clean.length);
  const realWordScore = clamp(morphCoverage * 130, 0, 100);
  if (morphs.length >= 2) drivers.push({ component: 'Real word parts', impact: round(realWordScore * 0.25, 1) });
  if (morphs.length === 0) detractors.push({ component: 'No recognizable words', impact: 8.0 });

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

  const tldSeo = (TLD_SEO_FACTOR[tld] || 0.75) * 100;
  if (tld === 'com') drivers.push({ component: '.com TLD', impact: 10.0 });
  if (tldSeo < 80) detractors.push({ component: 'Weak TLD for SEO', impact: round((80 - tldSeo) * 0.2, 1) });

  const hasImageable = morphs.some(m => IMAGEABLE_WORDS.has(m));
  const imageBonus = hasImageable ? 12 : 0;
  if (hasImageable) drivers.push({ component: 'Concrete/visual word', impact: 3.0 });

  const score = clamp(
    realWordScore * 0.30 + kwDensity * 0.15 + directRel * 0.15 + tldSeo * 0.25 + imageBonus + (clean.length <= 12 ? 10 : 0) * 0.15,
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Sub-scorer: Financial / Aftermarket Value
// ---------------------------------------------------------------------------

function scoreFinancial(label, tld, price, available, yearlyBudget, definitive) {
  const drivers = [];
  const detractors = [];
  const clean = label.replace(/-/g, '').toLowerCase();
  const len = clean.length;

  const lengthVal = LENGTH_VALUE_CURVE[Math.min(len, 20)] || 2;
  if (len <= 5) drivers.push({ component: 'Short domain premium', impact: round(lengthVal * 0.15, 1) });
  if (len >= 12) detractors.push({ component: 'Long domain discount', impact: round((100 - lengthVal) * 0.1, 1) });

  const tldMult = (TLD_VALUE_MULT[tld] || 0.08) * 100;
  if (tld === 'com') drivers.push({ component: '.com premium', impact: 12.0 });

  const allAlpha = /^[a-z]+$/.test(clean);
  const hasDigit = /\d/.test(clean);
  const hasHyphen = label.includes('-');
  const charComp = allAlpha ? 100 : hasHyphen ? 30 : hasDigit ? 50 : 70;
  if (allAlpha) drivers.push({ component: 'Pure alpha', impact: 5.0 });
  if (hasHyphen) detractors.push({ component: 'Hyphen reduces value', impact: 7.0 });

  const morphs = findMorphemes(clean);
  const dictBonus = morphs.some(m => m.length >= 4 && MORPHEMES.has(m)) ? 20 : 0;
  const singleWord = morphs.length === 1 && morphs[0].length === clean.length;
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
    availScore * 0.25 + affordability * 0.25 + estimatedValue * 0.01 * 20 + defScore * 0.08 + charComp * 0.07 + tldMult * 0.10 + lengthVal * 0.05,
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
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
  for (let i = 0; i < clean.length - 1; i++) {
    if (clean[i] === clean[i + 1]) repeatBonus += 5;
  }
  const bigramPairs = {};
  for (let i = 0; i < clean.length - 1; i++) {
    const bi = clean.slice(i, i + 2);
    bigramPairs[bi] = (bigramPairs[bi] || 0) + 1;
  }
  for (const count of Object.values(bigramPairs)) {
    if (count >= 2) repeatBonus += 10;
  }
  repeatBonus = Math.min(repeatBonus, 30);
  if (repeatBonus >= 10) drivers.push({ component: 'Pattern repetition', impact: round(repeatBonus * 0.12, 1) });

  const morphs = findMorphemes(clean);
  const hasImageable = morphs.some(m => IMAGEABLE_WORDS.has(m));
  const imageScore = hasImageable ? 25 : 0;
  if (hasImageable) drivers.push({ component: 'Visual/concrete word', impact: 5.0 });

  const uniqueChars = new Set(clean.split('')).size;
  const simplicity = clamp(100 - Math.max(0, uniqueChars - 7) * 10, 20, 100);

  const recallLen = clamp(100 - Math.max(0, len - 7) * 8, 15, 100);
  if (len <= 6) drivers.push({ component: 'Easy to recall', impact: round(recallLen * 0.1, 1) });
  if (len >= 13) detractors.push({ component: 'Hard to recall', impact: round((len - 12) * 4, 1) });

  const score = clamp(
    chunkScore * 0.25 + repeatBonus * 0.12 + imageScore * 0.15 + simplicity * 0.18 + recallLen * 0.30,
    0, 100
  );
  return { score: round(score, 1), drivers, detractors };
}

// ---------------------------------------------------------------------------
// Composite: scoreDomain
// ---------------------------------------------------------------------------

function scoreDomain(row, input) {
  const parts = row.domain.split('.');
  const label = parts[0] || '';
  const tld = parts.slice(1).join('.') || input.tld;
  const len = label.length;
  const syl = estimateSyllables(label);
  const keyTokens = tokenize(`${input.keywords} ${input.description}`);

  const phonetic = scorePhoneticQuality(label);
  const brand = scoreBrandability(label, keyTokens);
  const seo = scoreSeo(label, keyTokens, tld);
  const financial = scoreFinancial(label, tld, row.price, row.available, input.yearlyBudget, row.definitive);
  const memo = scoreMemorability(label);

  const afford = typeof row.price === 'number'
    ? clamp(110 - (row.price / Math.max(1, input.yearlyBudget)) * 60, 0, 100)
    : 50;

  const marketabilityScore = round(clamp(
    phonetic.score * 0.18 + brand.score * 0.35 + seo.score * 0.22 + memo.score * 0.25,
    0, 100
  ), 1);

  const financialValueScore = round(clamp(financial.score, 0, 100), 1);

  const intrinsicValue = round(clamp(
    phonetic.score * 0.12 + brand.score * 0.25 + seo.score * 0.15 +
    financial.score * 0.20 + memo.score * 0.13 + afford * 0.15,
    0, 100
  ), 1);

  const overallScore = round(clamp(intrinsicValue, 0, 100), 1);

  const valueDrivers = [].concat(
    phonetic.drivers, brand.drivers, seo.drivers, financial.drivers, memo.drivers
  ).sort((a, b) => b.impact - a.impact).slice(0, 5);

  const valueDetractors = [].concat(
    phonetic.detractors, brand.detractors, seo.detractors, financial.detractors, memo.detractors
  ).sort((a, b) => b.impact - a.impact).slice(0, 5);

  return {
    marketabilityScore,
    financialValueScore,
    overallScore,
    intrinsicValue,
    phoneticScore: phonetic.score,
    brandabilityScore: brand.score,
    seoScore: seo.score,
    memorabilityScore: memo.score,
    syllableCount: syl,
    labelLength: len,
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
      d.tokens[k] = { plays: Math.max(0, Math.floor(Number(v.plays) || 0)), reward: Number(v.reward) || 0 };
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
    const good = tokenRank.filter((x) => x.ucb >= 0.6).map((x) => x.token).slice(0, 15);
    const weak = new Set(tokenRank.filter((x) => x.ucb <= 0.35 && (this.model.tokens[x.token] || {}).plays >= 3).map((x) => x.token));

    const baseTokens = tokenize(this.base.keywords).slice(0, 12);

    const eliteTokens = [];
    for (const elite of this.model.elitePool.slice(0, 10)) {
      const label = elite.domain.split('.')[0] || '';
      const parts = label.split('-').filter(Boolean);
      for (const p of parts) {
        if (p.length >= 3 && !eliteTokens.includes(p)) eliteTokens.push(p);
      }
    }

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
      if (eliteTokens.length && r < 0.3) {
        src = eliteTokens;
      } else if (good.length && r < 0.7) {
        src = good;
      } else {
        src = baseTokens;
      }
      const t = pick(src.length ? src : baseTokens.length ? baseTokens : ['brand', 'company'], this.rand);
      if (t && !next.includes(t)) next.push(t);
    }

    this.curTokens = next.slice(0, 8);

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

    const tokens = tokenize(`${plan.input.keywords} ${plan.input.description}`).slice(0, 12);
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
    maxLength: plan.maxLength || 25,
    tld: plan.tld || 'com',
    style: plan.style || 'default',
    randomness: plan.randomness || 'medium',
    maxNames: plan.maxNames || 30,
    prevNames: prevNames || [],
  };
  sendIngest('engine.worker.js:fetchNamelixNames', 'Calling Namelix name generation API', { url, keywords: payload.keywords, style: payload.style, maxNames: payload.maxNames }, 'H3');
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
    sendIngest('engine.worker.js:fetchNamelixNames', 'Namelix API fetch exception', { url, error: msg }, 'H3');
    throw new Error('Namelix request failed: ' + msg);
  }
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    const msg = data.message || data.code || ('Namelix API error ' + res.status);
    sendIngest('engine.worker.js:fetchNamelixNames', 'Namelix API non-OK response', { url, status: res.status, message: msg, _debug: data._debug || null }, 'H3');
    throw new Error(msg);
  }
  const names = data.names || [];
  sendIngest('engine.worker.js:fetchNamelixNames', 'Namelix API success', {
    url,
    nameCount: names.length,
    _debug: data._debug || null,
    sampleNames: names.slice(0, 5).map(function (n) { return { domain: n.domain, businessName: n.businessName, source: n.source }; }),
  }, 'H3');
  if (data._debug) {
    self.postMessage({ type: 'debugLog', payload: { sessionId: 'efbcb6', location: 'engine.worker.js:fetchNamelixNames', message: 'Namelix API debug info', data: data._debug, timestamp: Date.now() } });
  }
  return names;
}

// ---------------------------------------------------------------------------
// Fetch: GoDaddy availability
// ---------------------------------------------------------------------------

const AVAILABILITY_CHUNK = 100;
const RDAP_DELAY_MS = 1200;

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
      sendIngest('engine.worker.js:fetchAvailability', 'Availability API fetch exception', { url, chunkSize: chunk.length, chunkOffset: i, errorMessage: msg }, 'H1');
      emitDebugLog('engine.worker.js:fetchAvailability', 'Availability API fetch exception', { url, chunkSize: chunk.length, chunkOffset: i, error: msg });
      throw new Error('Availability request failed: ' + msg);
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const statusMsg = String(res.status || 0) + (res.statusText ? ` ${res.statusText}` : '');
      const msg = data.message || data.code || statusMsg || 'Availability request failed.';
      sendIngest('engine.worker.js:fetchAvailability', 'Availability API non-OK response', { url, status: res.status, statusText: res.statusText, dataMessage: data.message, dataCode: data.code, errorMessage: msg }, 'H2');
      emitDebugLog('engine.worker.js:fetchAvailability', 'Availability API non-OK response', { url, chunkSize: chunk.length, chunkOffset: i, status: res.status, statusText: res.statusText, errorMessage: msg });
      throw new Error('Availability API error (' + statusMsg + '): ' + msg);
    }
    const results = data.results || {};
    if (data._debug) _lastDebug = data._debug;
    sendIngest('engine.worker.js:fetchAvailability', 'Availability API success response', {
      url, status: res.status, chunkSize: chunk.length, chunkOffset: i,
      resultCount: Object.keys(results).length, _debug: data._debug || null, syntheticData: false,
      sampleResults: Object.entries(results).slice(0, 3).map(function(e) { return { domain: e[0], available: e[1].available, price: e[1].price, reason: e[1].reason }; }),
    }, 'H1');
    if (!results || typeof results !== 'object') {
      emitDebugLog('engine.worker.js:fetchAvailability', 'Availability API invalid payload', { url, chunkSize: chunk.length, chunkOffset: i });
    }
    for (const key of Object.keys(results)) Object.assign(out, { [key]: results[key] });
  }
  out._debug = _lastDebug;
  return out;
}

// ---------------------------------------------------------------------------
// Fetch: RDAP fallback
// ---------------------------------------------------------------------------

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
// Snapshot
// ---------------------------------------------------------------------------

function snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pending) {
  const allRanked = sortRanked(Array.from(availableMap.values()), 'marketability');
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

// ---------------------------------------------------------------------------
// Main run loop
// ---------------------------------------------------------------------------

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
    const loopAllDomains = [];

    let considered = 0;
    let batches = 0;
    let limitHit = false;
    let stalls = 0;
    let skipReason;
    let nameSource = 'unknown';

    patch(job, { status: 'running', phase: 'namelix', progress: progress(input.loopCount, loop, 0.03), currentLoop: loop, totalLoops: input.loopCount });

    let cands = [];
    const prevNames = Array.from(availableMap.keys()).concat(Array.from(overBudgetMap.keys()), Array.from(unavailableMap.keys())).map(function (k) { return k.split('.')[0]; });

    if (backendBaseUrl) {
      try {
        const namelixNames = await fetchNamelixNames(backendBaseUrl, plan.input, prevNames.slice(0, 200));
        cands = namelixNames.map(function (n) {
          const key = n.domain.toLowerCase();
          if (seen.has(key)) return null;
          seen.add(key);
          return { domain: n.domain, sourceName: n.sourceName || n.businessName, premiumPricing: false };
        }).filter(Boolean);
        nameSource = 'Namelix API (namelix.com)';
        sendIngest('engine.worker.js:run', 'Name generation source', {
          source: nameSource, namelixApiCalled: true, syntheticNameGeneration: false,
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
      const seed = hash(`${job.id}|${loop}|0|0`);
      const batchMax = clamp(Math.floor(Math.max(plan.input.maxNames * 3, plan.input.maxNames, 80)), plan.input.maxNames, 250);
      cands = makeBatch(plan.input, seed, batchMax, seen);
      nameSource = 'LOCAL (makeBatch fallback)';
      sendIngest('engine.worker.js:run', 'Name generation source', {
        source: nameSource, namelixApiCalled: false, syntheticNameGeneration: true,
        candidateCount: cands.length,
        sampleCandidates: cands.slice(0, 3).map(function(c) { return { domain: c.domain, premiumPricing: c.premiumPricing }; }),
      }, 'H3');
    }

    considered += cands.length;
    batches += 1;

    {
      const pendingRows = cands.map(function (c) { return { domain: c.domain, sourceName: c.sourceName, premiumPricing: c.premiumPricing }; });
      patch(job, { status: 'running', phase: 'godaddy', progress: progress(input.loopCount, loop, 0.1 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))), currentLoop: loop, totalLoops: input.loopCount, results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, pendingRows) });

      let got = 0;
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

      patch(job, {
        status: 'running',
        phase: 'looping',
        progress: progress(input.loopCount, loop, 0.2 + 0.78 * (loopAvail.length / Math.max(1, plan.input.maxNames))),
        currentLoop: loop,
        totalLoops: input.loopCount,
        results: snapshot(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory, []),
      });
    }

    const rankedLoop = sortRanked(loopAvail, 'marketability');
    const reward = scoreReward(rankedLoop, optimizer.eliteSet);
    const step = optimizer.record(plan, reward, loopAllDomains);
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
      explorationRate: plan.explorationRate,
      elitePoolSize: plan.elitePoolSize,
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
      nameSource,
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
    results: { withinBudget: [], overBudget: [], unavailable: [], allRanked: [], loopSummaries: [], tuningHistory: [] },
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
