// Domain Name Wizard - Shared constants and utilities
// Loaded first via importScripts in engine.worker.js

const STYLE_VALUES = ['default', 'brandable', 'twowords', 'threewords', 'compound', 'spelling', 'nonenglish', 'dictionary'];
const RANDOMNESS_VALUES = ['low', 'medium', 'high'];
const LOOP_LIMIT = 251;
const MAX_STALL = 3;
const MAX_BATCH = 12;

const DB_NAME = 'domainname-wizard-browser';
const STORE = 'kv';
const MODEL_KEY = 'optimizer_v2';

const PREFIX = ['neo', 'prime', 'terra', 'ultra', 'atlas', 'delta', 'signal', 'lumen', 'forge', 'orbit'];
const SUFFIX = ['labs', 'works', 'base', 'flow', 'stack', 'hub', 'gen', 'pilot', 'ly', 'io'];
const DICT = ['horizon', 'ember', 'vector', 'harbor', 'beacon', 'origin', 'summit', 'apex'];

let WORD_FREQ = null;
let TRIGRAM_LM = null;
let CPC_TIERS_MAP = null;
let SALES_COMPS = null;
let CONCRETENESS_MAP = null;
let MODEL_WEIGHTS = null;
let LOADED_TLD_TIERS = null;
let LIQUIDITY_PARAMS = null;
let VDATA_LOADED = false;
let DEV_ECOSYSTEM_CACHE = new Map();
let DEV_ECOSYSTEM_DETAIL_CACHE = new Map();
let DEV_ECOSYSTEM_LAST_META = null;
let ARCHIVE_CACHE = new Map();

const FALLBACK_TLD_TIERS = {
  com: 1.0, ai: 0.85, io: 0.70, co: 0.55, net: 0.40, org: 0.42,
  app: 0.45, dev: 0.40, tech: 0.30, xyz: 0.12, me: 0.25, info: 0.15,
  biz: 0.10, pro: 0.20, cloud: 0.22, design: 0.18
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
  analytics: ['data','insight','metric','intelligence','reporting','forecast','model'],
  web: ['internet','online','site','browser','http','app','portal'],
  app: ['application','mobile','software','tool','program','service','utility'],
  health: ['medical','wellness','care','fit','bio','vital','cure'],
  fitness: ['health','wellness','training','workout','active','athletic','vital'],
  finance: ['money','bank','pay','invest','fund','capital','trade'],
  fintech: ['finance','payment','banking','wallet','credit','lending','capital'],
  payment: ['pay','wallet','checkout','billing','invoice','merchant','transfer'],
  market: ['commerce','sell','buy','shop','store','retail','brand'],
  ecommerce: ['market','commerce','retail','shop','store','checkout','catalog'],
  retail: ['shop','store','market','commerce','merchant','sale','outlet'],
  learn: ['education','study','teach','course','skill','tutor','academy'],
  education: ['learn','study','teach','course','training','academy','school'],
  build: ['construct','create','make','craft','forge','develop','design'],
  startup: ['launch','venture','founder','build','growth','scale','incubator'],
  fast: ['quick','rapid','speed','swift','instant','turbo','flash'],
  growth: ['scale','expand','boost','accelerate','uplift','momentum','traction'],
  secure: ['safe','protect','guard','shield','trust','vault','lock'],
  security: ['secure','protect','defend','shield','safety','privacy','trust'],
  connect: ['link','network','bridge','sync','join','unite','mesh'],
  social: ['community','network','share','connect','engage','circle','tribe'],
  green: ['eco','sustain','clean','renew','solar','earth','nature'],
  creative: ['design','art','craft','studio','canvas','pixel','media'],
  media: ['content','video','audio','stream','creative','studio','broadcast'],
  video: ['media','stream','watch','clip','film','motion','channel'],
  audio: ['sound','voice','podcast','music','stream','listen','sonic'],
  productivity: ['workflow','task','manage','plan','organize','track','focus'],
  automation: ['auto','workflow','bot','orchestrate','process','pipeline','streamline'],
  saas: ['cloud','software','platform','service','subscription','b2b','tool'],
  b2b: ['enterprise','business','saas','workflow','platform','service','team'],
  b2c: ['consumer','retail','commerce','market','brand','shop','mobile'],
  logistics: ['shipping','delivery','supply','freight','route','dispatch','transport'],
  supply: ['inventory','stock','warehouse','logistics','fulfill','procure','chain'],
  legal: ['law','attorney','counsel','compliance','contract','rights','policy'],
  realestate: ['property','home','realty','mortgage','housing','listing','rent'],
  travel: ['trip','journey','tour','hotel','booking','vacation','route'],
  food: ['meal','kitchen','restaurant','dining','snack','taste','chef'],
  coffee: ['cafe','brew','espresso','roast','bean','barista','latte'],
  gaming: ['game','esports','play','arcade','stream','quest','guild'],
  crypto: ['blockchain','token','wallet','defi','coin','ledger','chain'],
  hiring: ['talent','recruit','career','job','staff','workforce','people'],
  support: ['help','assist','service','care','success','desk','guidance'],
  sales: ['revenue','pipeline','deal','prospect','crm','growth','conversion'],
  brand: ['identity','name','logo','image','position','story','voice']
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
  const REPETITION_PENALTY_LEVELS = ['gentle', 'moderate', 'strong', 'very_severe', 'extremely_severe', 'excessive'];
  const rawRepLevel = (input.rewardPolicy && input.rewardPolicy.repetitionPenaltyLevel) || input.repetitionPenaltyLevel || 'strong';
  const repetitionPenaltyLevel = REPETITION_PENALTY_LEVELS.includes(String(rawRepLevel)) ? String(rawRepLevel) : 'strong';

  const rewardPolicyRaw = input.rewardPolicy && typeof input.rewardPolicy === 'object' ? input.rewardPolicy : null;
  const rewardPolicy = rewardPolicyRaw
    ? {
      performanceVsExploration: clamp(Number(rewardPolicyRaw.performanceVsExploration) || 0.78, 0.55, 0.95),
      quotaWeight: clamp(Number(rewardPolicyRaw.quotaWeight) || 0.22, 0.10, 0.35),
      undervalueWeight: clamp(Number(rewardPolicyRaw.undervalueWeight) || 0.24, 0.10, 0.40),
      qualityWeight: clamp(Number(rewardPolicyRaw.qualityWeight) || 0.24, 0.10, 0.40),
      availabilityWeight: clamp(Number(rewardPolicyRaw.availabilityWeight) || 0.18, 0.08, 0.35),
      inBudgetWeight: clamp(Number(rewardPolicyRaw.inBudgetWeight) || 0.12, 0.05, 0.30),
      repetitionPenaltyLevel,
    }
    : { repetitionPenaltyLevel };
  return {
    keywords,
    description: text(input.description),
    style,
    randomness,
    preferEnglish: input.preferEnglish !== false,
    blacklist: text(input.blacklist),
    tld,
    maxLength: Math.max(1, Math.round(Number(input.maxLength) || 10)),
    maxNames: Math.max(1, Math.round(Number(input.maxNames) || 5)),
    yearlyBudget: Math.max(1, Number(input.yearlyBudget) || 50),
    loopCount: Math.max(1, Math.round(Number(input.loopCount) || 100)),
    apiBaseUrl: text(input.apiBaseUrl),
    rewardPolicy,
    keywordLibraryTokens: Array.isArray(input.keywordLibraryTokens) ? input.keywordLibraryTokens.slice(0, 120) : [],
    keywordLibraryPhrases: Array.isArray(input.keywordLibraryPhrases) ? input.keywordLibraryPhrases.slice(0, 80) : [],
  };
}


// ---------------------------------------------------------------------------
// Load valuation data
// ---------------------------------------------------------------------------

async function loadValuationData() {
  if (VDATA_LOADED) return;
  try {
    const resp = await fetch('valuation_data.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const d = await resp.json();
    WORD_FREQ = new Map(Object.entries(d.wordFreq || {}));
    TRIGRAM_LM = new Map(Object.entries(d.trigrams || {}));
    CPC_TIERS_MAP = new Map();
    for (const [k, v] of Object.entries(d.cpcTiers || {})) CPC_TIERS_MAP.set(k, Number(v));
    SALES_COMPS = d.salesComps || [];
    CONCRETENESS_MAP = new Map(Object.entries(d.concreteness || {}));
    MODEL_WEIGHTS = d.modelWeights || {};
    LOADED_TLD_TIERS = d.tldTiers || {};
    LIQUIDITY_PARAMS = d.liquidityParams || {};
    VDATA_LOADED = true;
    emitDebugLog('worker-utils.js', 'Valuation data loaded', {
      words: WORD_FREQ.size, trigrams: TRIGRAM_LM.size, comps: SALES_COMPS.length
    });
  } catch (err) {
    emitDebugLog('worker-utils.js', 'Valuation data load failed, using fallback', { error: err.message });
    VDATA_LOADED = false;
  }
}

function getTldTier(tld) {
  if (LOADED_TLD_TIERS && LOADED_TLD_TIERS[tld] !== undefined) return LOADED_TLD_TIERS[tld];
  return FALLBACK_TLD_TIERS[tld] || 0.10;
}
