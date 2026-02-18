(function () {
  const formEl = document.getElementById('search-form');
  const startBtn = document.getElementById('start-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const downloadJsonBtn = document.getElementById('download-json-btn');

  const formErrorEl = document.getElementById('form-error');
  const jobErrorEl = document.getElementById('job-error');

  const jobIdEl = document.getElementById('job-id');
  const statusLabelEl = document.getElementById('status-label');
  const progressLabelEl = document.getElementById('progress-label');
  const loopLabelEl = document.getElementById('loop-label');
  const elapsedLabelEl = document.getElementById('elapsed-label');
  const progressFillEl = document.getElementById('progress-fill');

  const resultsPanelEl = document.getElementById('results-panel');
  const sortModeEl = document.getElementById('sort-mode');
  const summaryKpisEl = document.getElementById('summary-kpis');
  const allRankedTableEl = document.getElementById('all-ranked-table');
  const withinBudgetTableEl = document.getElementById('within-budget-table');
  const overBudgetTableEl = document.getElementById('over-budget-table');
  const unavailableTableEl = document.getElementById('unavailable-table');
  const loopSummaryTableEl = document.getElementById('loop-summary-table');
  const tuningTableEl = document.getElementById('tuning-table');

  let currentJob = null;
  let currentResults = null;
  let currentSortMode = 'marketability';
  const debugLogs = [];
  let lastLoggedJobErrorKey = '';
  let latestRunExport = null;

  const LEGACY_VERCEL_BACKEND_URL = 'https://order-skew-p3cuhj7l0-yanniedogs-projects.vercel.app';
  const BACKEND_URL = (function () {
    if (typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol || '') && window.location.origin) {
      return window.location.origin;
    }
    return LEGACY_VERCEL_BACKEND_URL;
  })();

  function escapeHtml(input) {
    const div = document.createElement('div');
    div.textContent = input == null ? '' : String(input);
    return div.innerHTML;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatMoney(value, currency) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '-';
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  }

  function formatScore(value, digits) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '-';
    }
    return value.toFixed(digits == null ? 1 : digits);
  }

  function formatElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return '00:00';
    }
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remSeconds = seconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remSeconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(remSeconds).padStart(2, '0')}`;
  }

  function phaseLabel(status, phase) {
    if (status === 'queued') return 'Queued';
    if (status === 'running' && phase === 'looping') return 'Iterative tuning';
    if (status === 'running' && phase === 'namelix') return 'Generating candidates';
    if (status === 'running' && phase === 'godaddy') return 'Checking availability (GoDaddy or RDAP)';
    if (status === 'running' && phase === 'finalize') return 'Finalizing';
    if (status === 'done') return 'Done';
    if (status === 'failed') return 'Failed';
    return status || 'Idle';
  }

  function showFormError(message) {
    if (!message) {
      formErrorEl.hidden = true;
      formErrorEl.textContent = '';
      return;
    }
    formErrorEl.hidden = false;
    formErrorEl.textContent = message;
  }

  function showJobError(message) {
    if (!message) {
      jobErrorEl.hidden = true;
      jobErrorEl.textContent = '';
      return;
    }
    jobErrorEl.hidden = false;
    jobErrorEl.textContent = message;
  }

  function compareOverallTieBreak(a, b) {
    if ((a.overallScore || 0) !== (b.overallScore || 0)) {
      return (b.overallScore || 0) - (a.overallScore || 0);
    }
    return String(a.domain || '').localeCompare(String(b.domain || ''));
  }

  function pushDebugLog(location, message, data) {
    debugLogs.push({
      sessionId: '437d46',
      location: String(location || 'app.js'),
      message: String(message || 'log'),
      data: data || {},
      timestamp: Date.now(),
    });
  }

  function cloneForExport(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  }

  function sortRows(rows, mode) {
    const copy = Array.isArray(rows) ? rows.slice() : [];
    copy.sort((a, b) => {
      if (mode === 'financialValue') {
        if ((a.financialValueScore || 0) !== (b.financialValueScore || 0)) {
          return (b.financialValueScore || 0) - (a.financialValueScore || 0);
        }
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'alphabetical') {
        const alpha = String(a.domain || '').localeCompare(String(b.domain || ''));
        if (alpha !== 0) return alpha;
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'syllableCount') {
        if ((a.syllableCount || 0) !== (b.syllableCount || 0)) {
          return (a.syllableCount || 0) - (b.syllableCount || 0);
        }
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'labelLength') {
        if ((a.labelLength || 0) !== (b.labelLength || 0)) {
          return (a.labelLength || 0) - (b.labelLength || 0);
        }
        return compareOverallTieBreak(a, b);
      }
      if ((a.marketabilityScore || 0) !== (b.marketabilityScore || 0)) {
        return (b.marketabilityScore || 0) - (a.marketabilityScore || 0);
      }
      return compareOverallTieBreak(a, b);
    });
    return copy;
  }

  function renderSummary(results) {
    const allRanked = results.allRanked || [];
    if (allRanked.length === 0) {
      summaryKpisEl.innerHTML = '<p>No ranked domains yet.</p>';
      return;
    }

    const avg = (field) => allRanked.reduce((sum, row) => sum + (Number(row[field]) || 0), 0) / allRanked.length;
    const top = sortRows(allRanked, currentSortMode)[0];
    const positiveBudget = (results.withinBudget || []).length;

    summaryKpisEl.innerHTML = [
      { label: 'Ranked Domains', value: String(allRanked.length) },
      { label: 'Within Budget', value: String(positiveBudget) },
      { label: 'Avg Overall Score', value: formatScore(avg('overallScore'), 2) },
      { label: 'Avg Marketability', value: formatScore(avg('marketabilityScore'), 2) },
      { label: 'Avg Financial', value: formatScore(avg('financialValueScore'), 2) },
      { label: 'Top Domain', value: top ? escapeHtml(top.domain) : '-' },
    ]
      .map((item) => `<article class="summary-card"><span>${item.label}</span><strong>${item.value}</strong></article>`)
      .join('');
  }

  function renderDomainTable(rows, includeAvailability) {
    if (!rows || rows.length === 0) {
      return '<p>No rows.</p>';
    }

    const availabilityHeader = includeAvailability ? '<th>Availability</th>' : '';
    const availabilityCell = (row) => {
      if (!includeAvailability) return '';
      return `<td class="${row.available ? 'good' : 'bad'}">${row.available ? 'Available' : 'Unavailable'}</td>`;
    };

    const body = rows
      .map((row) => {
        const priceCell = row._pending ? '...' : formatMoney(row.price, row.currency);
        return `
          <tr>
            <td>${escapeHtml(row.domain)}</td>
            ${availabilityCell(row)}
            <td>${priceCell}</td>
            <td>${row.overBudget ? '<span class="bad">Yes</span>' : 'No'}</td>
            <td>${row.isNamelixPremium ? 'Yes' : 'No'}</td>
            <td>${formatScore(row.marketabilityScore, 1)}</td>
            <td>${formatScore(row.financialValueScore, 1)}</td>
            <td>${formatScore(row.overallScore, 1)}</td>
            <td>${Number(row.syllableCount || 0)}</td>
            <td>${Number(row.labelLength || 0)}</td>
            <td>${Number(row.timesDiscovered || 0)}</td>
            <td>${Number(row.firstSeenLoop || 0)}</td>
            <td>${Number(row.lastSeenLoop || 0)}</td>
            <td>${escapeHtml((row.valueDrivers || []).map((x) => `${x.component} (${formatScore(x.impact, 1)})`).join(', ') || '-')}</td>
            <td>${escapeHtml((row.valueDetractors || []).map((x) => `${x.component} (${formatScore(x.impact, 1)})`).join(', ') || '-')}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            ${availabilityHeader}
            <th>Price</th>
            <th>Over Budget</th>
            <th>Premium</th>
            <th>Marketability</th>
            <th>Financial</th>
            <th>Overall</th>
            <th>Syllables</th>
            <th>Label Len</th>
            <th>Seen</th>
            <th>First Loop</th>
            <th>Last Loop</th>
            <th>Value Drivers</th>
            <th>Detractors</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function renderLoopSummaryTable(rows) {
    if (!rows || rows.length === 0) {
      return '<p>No loop summaries yet.</p>';
    }

    return `
      <table>
        <thead>
          <tr>
            <th>Loop</th>
            <th>Keywords</th>
            <th>Style</th>
            <th>Randomness</th>
            <th>Mutation</th>
            <th>Required</th>
            <th>Available</th>
            <th>Quota Met</th>
            <th>251 Hit</th>
            <th>Considered</th>
            <th>Batches</th>
            <th>Avg Score</th>
            <th>Top Domain</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `
              <tr>
                <td>${row.loop}</td>
                <td>${escapeHtml(row.keywords || '-')}</td>
                <td>${escapeHtml(row.style || '-')}</td>
                <td>${escapeHtml(row.randomness || '-')}</td>
                <td>${escapeHtml(row.mutationIntensity || '-')}</td>
                <td>${Number(row.requiredQuota || 0)}</td>
                <td>${Number(row.availableCount || 0)}</td>
                <td>${row.quotaMet ? '<span class="good">Yes</span>' : 'No'}</td>
                <td>${row.limitHit ? '<span class="bad">Yes</span>' : 'No'}</td>
                <td>${Number(row.consideredCount || 0)}</td>
                <td>${Number(row.batchCount || 0)}</td>
                <td>${formatScore(row.averageOverallScore, 2)}</td>
                <td>${escapeHtml(row.topDomain || '-')}</td>
                <td>${escapeHtml(row.skipReason || '-')}</td>
              </tr>
            `)
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderTuningTable(rows) {
    if (!rows || rows.length === 0) {
      return '<p>No tuning history yet.</p>';
    }

    return `
      <table>
        <thead>
          <tr>
            <th>Loop</th>
            <th>Source Loop</th>
            <th>Keywords</th>
            <th>Description</th>
            <th>Style</th>
            <th>Randomness</th>
            <th>Mutation</th>
            <th>Reward</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `
              <tr>
                <td>${row.loop}</td>
                <td>${row.sourceLoop == null ? '-' : row.sourceLoop}</td>
                <td>${escapeHtml(row.keywords || '-')}</td>
                <td>${escapeHtml(row.description || '-')}</td>
                <td>${escapeHtml(row.selectedStyle || '-')}</td>
                <td>${escapeHtml(row.selectedRandomness || '-')}</td>
                <td>${escapeHtml(row.selectedMutationIntensity || '-')}</td>
                <td>${formatScore(row.reward, 4)}</td>
              </tr>
            `)
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderResults(results) {
    if (!results) {
      resultsPanelEl.hidden = true;
      return;
    }

    const allRanked = results.allRanked || [];
    const pending = results.pending || [];
    const pendingRows = pending.map(function (p) {
      const label = String(p.domain || '').split('.')[0];
      return {
        domain: p.domain,
        sourceName: p.sourceName,
        isNamelixPremium: Boolean(p.isNamelixPremium),
        available: null,
        price: undefined,
        overBudget: false,
        marketabilityScore: 0,
        financialValueScore: 0,
        overallScore: 0,
        syllableCount: 0,
        labelLength: label.length,
        timesDiscovered: 0,
        firstSeenLoop: 0,
        lastSeenLoop: 0,
        valueDrivers: [],
        valueDetractors: [],
        _pending: true,
      };
    });
    const combinedRanked = allRanked.concat(pendingRows);
    // #region agent log
    allRanked.slice(0, 2).forEach(function (row, i) {
      debugLogs.push({ sessionId: '437d46', location: 'app.js:renderResults', message: 'UI row', data: { index: i, domain: row.domain, price: row.price, isNamelixPremium: row.isNamelixPremium, hypothesisId: 'H4' }, timestamp: Date.now() });
    });
    // #endregion
    const sortedRanked = sortRows(combinedRanked, currentSortMode);
    const withinBudget = sortRows(results.withinBudget || [], currentSortMode);
    const overBudget = sortRows(results.overBudget || [], currentSortMode);
    const unavailable = sortRows(results.unavailable || [], currentSortMode);

    renderSummary(results);
    allRankedTableEl.innerHTML = renderDomainTable(sortedRanked, false);
    withinBudgetTableEl.innerHTML = renderDomainTable(withinBudget, false);
    overBudgetTableEl.innerHTML = renderDomainTable(overBudget, false);
    unavailableTableEl.innerHTML = renderDomainTable(unavailable, true);

    loopSummaryTableEl.innerHTML = renderLoopSummaryTable(results.loopSummaries || []);
    tuningTableEl.innerHTML = renderTuningTable(results.tuningHistory || []);

    resultsPanelEl.hidden = false;
  }

  function collectInput() {
    const data = new FormData(formEl);
    return {
      keywords: String(data.get('keywords') || '').trim(),
      description: String(data.get('description') || '').trim(),
      style: String(data.get('style') || 'default'),
      randomness: String(data.get('randomness') || 'medium'),
      blacklist: String(data.get('blacklist') || '').trim(),
      maxLength: clamp(Math.round(parseNumber(data.get('maxLength'), 25)), 5, 25),
      tld: String(data.get('tld') || 'com').trim(),
      maxNames: clamp(Math.round(parseNumber(data.get('maxNames'), 100)), 1, 250),
      yearlyBudget: clamp(parseNumber(data.get('yearlyBudget'), 50), 1, 100000),
      loopCount: clamp(Math.round(parseNumber(data.get('loopCount'), 10)), 1, 25),
      apiBaseUrl: BACKEND_URL,
    };
  }

  function createInPageEngine() {
    const listeners = { message: [], error: [] };
    const STYLE_VALUES = ['default', 'brandable', 'twowords', 'threewords', 'compound', 'spelling', 'nonenglish', 'dictionary'];
    const RANDOMNESS_VALUES = ['low', 'medium', 'high'];
    const PREFIXES = ['neo', 'prime', 'terra', 'atlas', 'signal', 'lumen', 'delta', 'orbit'];
    const SUFFIXES = ['labs', 'works', 'flow', 'hub', 'gen', 'base', 'stack', 'pilot', 'ly'];
    const WORDS = ['horizon', 'ember', 'vector', 'harbor', 'beacon', 'origin', 'summit', 'apex'];
    const MODEL_STORAGE_KEY = 'domainname_wizard_optimizer_v1';
    const runningJobs = new Set();
    const canceledJobs = new Set();

    function emit(type, payload) {
      for (const handler of listeners[type] || []) {
        try {
          handler(payload);
        } catch (error) {
          // Keep engine alive if one listener fails.
        }
      }
    }

    function emitState(job) {
      emit('message', { data: { type: 'state', job: JSON.parse(JSON.stringify(job)) } });
    }

    function emitError(message, jobId) {
      emit('message', { data: { type: 'error', message: String(message || 'In-page engine error.'), jobId: jobId || null } });
    }

    function hash(input) {
      const raw = String(input || '');
      let h = 2166136261;
      for (let i = 0; i < raw.length; i += 1) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function seeded(seed) {
      let s = seed >>> 0;
      return function next() {
        s += 0x6d2b79f5;
        let x = s;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    }

    function pick(list, random) {
      if (!list.length) return '';
      return list[Math.floor(random() * list.length)];
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function tokenize(input) {
      return String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]+/g, ' ')
        .split(/[\s-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .slice(0, 12);
    }

    function labelize(input) {
      const value = String(input || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['\u2019]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (!value || value.length > 63) return null;
      if (!/^[a-z0-9-]+$/.test(value)) return null;
      return value;
    }

    function averageReward(stats) {
      if (!stats || stats.plays === 0) return 0.55;
      return stats.reward / stats.plays;
    }

    function loadModel() {
      try {
        const raw = window.localStorage.getItem(MODEL_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return {
          style: Object.fromEntries(STYLE_VALUES.map((style) => [style, parsed.style?.[style] || { plays: 0, reward: 0 }])),
          randomness: Object.fromEntries(RANDOMNESS_VALUES.map((mode) => [mode, parsed.randomness?.[mode] || { plays: 0, reward: 0 }])),
          tokens: parsed.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : {},
        };
      } catch {
        return {
          style: Object.fromEntries(STYLE_VALUES.map((style) => [style, { plays: 0, reward: 0 }])),
          randomness: Object.fromEntries(RANDOMNESS_VALUES.map((mode) => [mode, { plays: 0, reward: 0 }])),
          tokens: {},
        };
      }
    }

    function saveModel(model) {
      try {
        window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model));
      } catch {
        // Ignore storage quota or private-mode failures.
      }
    }

    function chooseArm(bandit, arms, epsilon, random) {
      if (random() < epsilon) return pick(arms, random);
      let best = arms[0];
      let bestScore = -Infinity;
      for (const arm of arms) {
        const score = averageReward(bandit[arm]);
        if (score > bestScore || (score === bestScore && random() > 0.5)) {
          best = arm;
          bestScore = score;
        }
      }
      return best;
    }

    function updateBanditStat(stats, reward) {
      stats.plays += 1;
      stats.reward += reward;
    }

    function buildSourceName(style, a, b, c, random) {
      if (style === 'twowords') return `${a}${b}`;
      if (style === 'threewords') return `${a}${b}${c}`;
      if (style === 'compound') return `${a}${pick(SUFFIXES, random)}`;
      if (style === 'brandable') return `${a.slice(0, Math.ceil(a.length / 2))}${b.slice(Math.floor(b.length / 2))}`;
      if (style === 'spelling') {
        let out = `${a}${b}`;
        out = out.replace(/ph/g, 'f').replace(/x/g, 'ks').replace(/c/g, 'k');
        if (out.length > 3 && random() > 0.6) out = `${out.slice(0, -1)}${pick(['i', 'y', 'o'], random)}`;
        return out;
      }
      if (style === 'nonenglish') return `${a.slice(0, Math.ceil(a.length / 2))}${b.slice(Math.floor(b.length / 2))}${pick(['a', 'o', 'i', 'u'], random)}`;
      if (style === 'dictionary') return `${pick(WORDS, random)}${a}`;
      return `${pick(PREFIXES, random)}${a}${pick(SUFFIXES, random)}`;
    }

    function scoreRow(row, input) {
      const label = String(row.domain || '').split('.')[0] || '';
      const tokens = tokenize(`${input.keywords} ${input.description || ''}`);
      const vowels = (label.match(/[aeiouy]/g) || []).length;
      const vowelRatio = vowels / Math.max(1, label.length);
      const pronounceability = clamp(100 - Math.abs(vowelRatio - 0.42) * 220, 0, 100);
      const lengthScore = clamp(100 - Math.abs(label.length - 9) * 10, 0, 100);
      const syllableCount = Math.max(1, (label.match(/[aeiouy]+/g) || []).length || 1);
      const syllableScore = syllableCount >= 2 && syllableCount <= 3 ? 100 : syllableCount === 1 || syllableCount === 4 ? 78 : 52;
      let matches = 0;
      for (const token of tokens) if (label.includes(token)) matches += 1;
      const relevance = tokens.length ? clamp(30 + (matches / tokens.length) * 70, 0, 100) : 35;
      const distinctiveness = clamp((new Set(label.replace(/-/g, '').split('')).size / Math.max(1, label.replace(/-/g, '').length)) * 120, 0, 100);
      const marketabilityScore = round2(
        clamp(
          lengthScore * 0.22 +
            syllableScore * 0.18 +
            pronounceability * 0.2 +
            relevance * 0.16 +
            distinctiveness * 0.1 +
            (label.includes('-') ? 28 : 100) * 0.08 +
            (/\d/.test(label) ? 24 : 100) * 0.06,
          0,
          100,
        ),
      );
      const affordability = typeof row.price === 'number' ? clamp(112 - (row.price / Math.max(1, input.yearlyBudget)) * 65, 0, 100) : 50;
      let financialValueScore = round2(
        clamp(
          (row.available ? 100 : 0) * 0.35 +
            (row.definitive ? 100 : 62) * 0.12 +
            affordability * 0.38 +
            (row.isNamelixPremium ? 35 : 100) * 0.15,
          0,
          100,
        ),
      );
      if (row.overBudget) financialValueScore = round2(financialValueScore * 0.82);
      if (!row.available) financialValueScore = round2(financialValueScore * 0.45);
      const overallScore = round2(clamp(financialValueScore * 0.62 + marketabilityScore * 0.38, 0, 100));
      return {
        marketabilityScore,
        financialValueScore,
        overallScore,
        syllableCount,
        labelLength: label.length,
        valueDrivers: [],
        valueDetractors: [],
      };
    }

    function buildResults(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory) {
      const allRanked = sortRows(Array.from(availableMap.values()), 'marketability');
      const withinBudget = allRanked.slice().sort((a, b) => {
        const ap = typeof a.price === 'number' ? a.price : Number.POSITIVE_INFINITY;
        const bp = typeof b.price === 'number' ? b.price : Number.POSITIVE_INFINITY;
        return ap - bp || String(a.domain || '').localeCompare(String(b.domain || ''));
      });
      return {
        withinBudget,
        overBudget: sortRows(Array.from(overBudgetMap.values()), 'financialValue'),
        unavailable: sortRows(Array.from(unavailableMap.values()), 'marketability'),
        allRanked,
        loopSummaries: loopSummaries.slice(),
        tuningHistory: tuningHistory.slice(),
      };
    }

    async function runJob(job) {
      const input = job.input;
      const availableMap = new Map();
      const overBudgetMap = new Map();
      const unavailableMap = new Map();
      const loopSummaries = [];
      const tuningHistory = [];
      const model = loadModel();
      const random = seeded(hash(job.id));
      let currentKeywords = tokenize(input.keywords).slice(0, 8);
      let bestLoop = null;
      let bestReward = -1;

      patch(job, {
        status: 'running',
        phase: 'looping',
        progress: 5,
        currentLoop: 0,
        totalLoops: input.loopCount,
        results: buildResults(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory),
      }, false);
      emitState(job);

      for (let loop = 1; loop <= input.loopCount; loop += 1) {
        if (canceledJobs.has(job.id)) throw new Error('Run canceled by user.');

        const style = chooseArm(model.style, STYLE_VALUES, 0.24, random);
        const randomness = chooseArm(model.randomness, RANDOMNESS_VALUES, 0.24, random);
        const mutationIntensity = random() > 0.66 ? 'high' : random() > 0.33 ? 'medium' : 'low';
        const mutCount = mutationIntensity === 'high' ? 3 : mutationIntensity === 'medium' ? 2 : 1;

        const tokenRank = Object.entries(model.tokens || {})
          .map(([token, stats]) => ({ token, avg: averageReward(stats) }))
          .sort((a, b) => b.avg - a.avg);
        const positiveTokens = tokenRank.filter((item) => item.avg >= 0.58).map((item) => item.token).slice(0, 12);
        const weakTokens = new Set(tokenRank.filter((item) => item.avg <= 0.4).map((item) => item.token).slice(0, 20));
        const baseTokens = tokenize(input.keywords);
        const poolTokens = currentKeywords.length ? currentKeywords.slice() : baseTokens.slice(0, 6);
        for (let i = 0; i < mutCount; i += 1) {
          if (poolTokens.length > 2) {
            const weakIdx = poolTokens.findIndex((token) => weakTokens.has(token));
            const removeIdx = weakIdx >= 0 ? weakIdx : Math.floor(random() * poolTokens.length);
            poolTokens.splice(removeIdx, 1);
          }
          const source = positiveTokens.length && random() > 0.2 ? positiveTokens : baseTokens;
          const candidate = pick(source.length ? source : ['brand', 'company'], random);
          if (candidate && !poolTokens.includes(candidate)) poolTokens.push(candidate);
        }
        currentKeywords = poolTokens.slice(0, 8);
        const loopInput = { ...input, style, randomness, keywords: currentKeywords.join(' ') || input.keywords };

        const seenDomains = new Set();
        const loopAvailable = [];
        let consideredCount = 0;
        let batchCount = 0;
        let limitHit = false;
        let skipReason = undefined;
        let stalled = 0;

        while (loopAvailable.length < loopInput.maxNames) {
          if (canceledJobs.has(job.id)) throw new Error('Run canceled by user.');
          if (consideredCount >= 251) {
            limitHit = true;
            skipReason = 'Considered-name cap of 251 reached.';
            break;
          }
          if (batchCount >= 12) {
            skipReason = 'Batch attempt cap (12) reached before quota.';
            break;
          }

          patch(job, {
            phase: 'namelix',
            progress: Math.round(5 + ((loop - 1 + loopAvailable.length / Math.max(1, loopInput.maxNames)) / loopInput.loopCount) * 90),
            currentLoop: loop,
          }, false);
          emitState(job);

          const remaining = loopInput.maxNames - loopAvailable.length;
          const batchTarget = clamp(Math.floor(Math.max(remaining * 3, remaining, Math.min(loopInput.maxNames, 80))), remaining, 250);
          const loopRandom = seeded(hash(`${job.id}:${loop}:${batchCount}:${consideredCount}`));
          const candidatePool = tokenize(`${loopInput.keywords} ${loopInput.description}`);
          const blacklist = new Set(
            String(loopInput.blacklist || '')
              .split(',')
              .map((token) => token.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
              .filter(Boolean),
          );

          let attempts = 0;
          let gained = 0;
          while (gained < batchTarget && attempts < batchTarget * 20) {
            attempts += 1;
            const a = pick(candidatePool.length ? candidatePool : ['nova', 'orbit', 'lumen', 'forge', 'signal'], loopRandom);
            const b = pick(candidatePool.length ? candidatePool : ['spark', 'scale', 'craft', 'pilot', 'pulse'], loopRandom);
            const c = pick(candidatePool.length ? candidatePool : ['core', 'path', 'nest', 'beam', 'lift'], loopRandom);
            let sourceName = buildSourceName(style, a, b, c, loopRandom);
            if (randomness === 'high' && loopRandom() > 0.45) sourceName += pick(SUFFIXES, loopRandom);
            if (randomness === 'low' && sourceName.length > 16) sourceName = sourceName.slice(0, 16);

            const label = labelize(sourceName);
            if (!label || label.length > loopInput.maxLength) continue;
            let blocked = false;
            for (const token of blacklist) {
              if (token && label.includes(token)) {
                blocked = true;
                break;
              }
            }
            if (blocked) continue;

            const domain = `${label}.${loopInput.tld || 'com'}`;
            if (seenDomains.has(domain.toLowerCase())) continue;
            seenDomains.add(domain.toLowerCase());
            consideredCount += 1;
            gained += 1;

            patch(job, {
              phase: 'godaddy',
              progress: Math.round(5 + ((loop - 1 + (loopAvailable.length + 0.2) / Math.max(1, loopInput.maxNames)) / loopInput.loopCount) * 90),
              currentLoop: loop,
            }, false);

            const entropy = hash(`${domain}:${loop}:${batchCount}:${consideredCount}`);
            const availability = ((entropy % 10000) / 10000) < clamp(0.72 - (randomness === 'high' ? 0.08 : randomness === 'medium' ? 0.03 : 0) - Math.max(0, label.length - 12) * 0.012, 0.2, 0.92);
            const tldBase = ({ com: 13, net: 14, org: 13, io: 36, ai: 82, co: 26, app: 20, dev: 18 }[loopInput.tld || 'com'] || 18);
            const premium = (hash(`${domain}|premium`) % 100) < (style === 'brandable' ? 22 : 12);
            const price = clamp(
              tldBase +
                Math.max(0, 10 - label.length) * 8.2 -
                Math.max(0, label.length - 12) * 1.25 +
                (style === 'brandable' ? 6 : style === 'dictionary' ? -1.5 : 0) +
                (premium ? 35 + ((entropy >>> 8) % 90) : 0) +
                ((entropy >>> 16) % 1500) / 100,
              tldBase * 0.75,
              4500,
            );

            const row = {
              domain,
              sourceName,
              isNamelixPremium: premium,
              available: availability,
              definitive: true,
              price,
              currency: 'USD',
              period: 1,
              reason: availability ? 'Likely available (local heuristic).' : 'Likely unavailable (local heuristic).',
              overBudget: availability ? price > loopInput.yearlyBudget : false,
            };
            const ranked = {
              ...row,
              ...scoreRow(row, loopInput),
              firstSeenLoop: loop,
              lastSeenLoop: loop,
              timesDiscovered: 1,
            };

            const targetMap = ranked.available
              ? ranked.overBudget
                ? overBudgetMap
                : availableMap
              : unavailableMap;
            const key = ranked.domain.toLowerCase();
            const existing = targetMap.get(key);
            if (!existing || ranked.overallScore > existing.overallScore) {
              targetMap.set(key, ranked);
            } else {
              targetMap.set(key, { ...existing, lastSeenLoop: loop, timesDiscovered: (existing.timesDiscovered || 1) + 1 });
            }

            if (ranked.available && !ranked.overBudget) {
              loopAvailable.push(ranked);
              if (loopAvailable.length >= loopInput.maxNames) break;
            }

            if (consideredCount >= 251) {
              limitHit = true;
              skipReason = 'Considered-name cap of 251 reached.';
              break;
            }
          }

          const availableInBatch = loopAvailable.length;
          stalled = availableInBatch === 0 ? stalled + 1 : 0;
          if (stalled >= 3) {
            skipReason = 'No newly qualifying domains across 3 consecutive batches.';
            break;
          }
          batchCount += 1;

          patch(job, {
            phase: 'looping',
            progress: Math.round(5 + ((loop - 1 + loopAvailable.length / Math.max(1, loopInput.maxNames)) / loopInput.loopCount) * 90),
            currentLoop: loop,
            results: buildResults(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory),
          }, false);
          emitState(job);

          await sleep(35 + Math.floor(Math.random() * 65));
        }

        const rankedLoop = sortRows(loopAvailable, 'marketability');
        const reward =
          rankedLoop.length === 0
            ? 0
            : round2(
                clamp(
                  rankedLoop
                    .slice(0, Math.min(5, rankedLoop.length))
                    .reduce((sum, row) => sum + (row.overallScore || 0), 0) /
                    Math.min(5, rankedLoop.length) /
                    100,
                  0,
                  1,
                ),
              );

        updateBanditStat(model.style[style], reward);
        updateBanditStat(model.randomness[randomness], reward);
        for (const token of tokenize(`${loopInput.keywords} ${loopInput.description}`)) {
          if (!model.tokens[token]) model.tokens[token] = { plays: 0, reward: 0 };
          updateBanditStat(model.tokens[token], reward);
        }
        if (reward >= bestReward) {
          bestReward = reward;
          bestLoop = loop;
        }

        tuningHistory.push({
          loop,
          sourceLoop: bestLoop,
          keywords: loopInput.keywords,
          description: loopInput.description || '',
          selectedStyle: style,
          selectedRandomness: randomness,
          selectedMutationIntensity: mutationIntensity,
          reward: Number(reward.toFixed(4)),
        });

        loopSummaries.push({
          loop,
          keywords: loopInput.keywords,
          description: loopInput.description || '',
          style,
          randomness,
          mutationIntensity,
          requiredQuota: loopInput.maxNames,
          quotaMet: rankedLoop.length >= loopInput.maxNames,
          skipped: rankedLoop.length < loopInput.maxNames,
          limitHit,
          skipReason,
          consideredCount,
          batchCount,
          discoveredCount: rankedLoop.length,
          availableCount: rankedLoop.length,
          withinBudgetCount: rankedLoop.length,
          averageOverallScore: rankedLoop.length
            ? Number((rankedLoop.reduce((sum, row) => sum + (row.overallScore || 0), 0) / rankedLoop.length).toFixed(2))
            : 0,
          topDomain: rankedLoop[0]?.domain,
          topScore: rankedLoop[0]?.overallScore,
        });

        patch(job, {
          phase: 'looping',
          progress: Math.round(5 + (loop / loopInput.loopCount) * 90),
          currentLoop: loop,
          results: buildResults(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory),
        }, false);
        emitState(job);
      }

      saveModel(model);

      patch(job, {
        status: 'done',
        phase: 'finalize',
        progress: 100,
        completedAt: Date.now(),
        currentLoop: input.loopCount,
        totalLoops: input.loopCount,
        results: buildResults(availableMap, overBudgetMap, unavailableMap, loopSummaries, tuningHistory),
      }, false);
      emitState(job);
    }

    function start(message) {
      const input = message?.input || {};
      if (runningJobs.size > 0) {
        const activeId = Array.from(runningJobs)[0];
        emitError(`Run already active (${activeId}). Cancel or wait before starting another.`, activeId);
        return;
      }

      let parsedInput;
      try {
        parsedInput = {
          keywords: String(input.keywords || '').trim(),
          description: String(input.description || '').trim(),
          style: STYLE_VALUES.includes(input.style) ? input.style : 'default',
          randomness: RANDOMNESS_VALUES.includes(input.randomness) ? input.randomness : 'medium',
          blacklist: String(input.blacklist || '').trim(),
          maxLength: clamp(Math.round(Number(input.maxLength) || 25), 5, 25),
          tld: String(input.tld || 'com').trim().replace(/^\./, '').toLowerCase(),
          maxNames: clamp(Math.round(Number(input.maxNames) || 100), 1, 250),
          yearlyBudget: clamp(Number(input.yearlyBudget) || 50, 1, 100000),
          loopCount: clamp(Math.round(Number(input.loopCount) || 10), 1, 25),
        };
        if (!parsedInput.keywords || parsedInput.keywords.length < 2) {
          throw new Error('Keywords must be at least 2 characters.');
        }
        if (!/^[a-z0-9-]{2,24}$/.test(parsedInput.tld)) {
          throw new Error('Invalid TLD.');
        }
      } catch (error) {
        emitError(error instanceof Error ? error.message : 'Invalid input payload.');
        return;
      }

      const createdAt = Date.now();
      const job = {
        id: `${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 6)}`,
        status: 'queued',
        phase: null,
        progress: 0,
        input: parsedInput,
        createdAt,
        updatedAt: createdAt,
        startedAt: createdAt,
        completedAt: null,
        currentLoop: 0,
        totalLoops: parsedInput.loopCount,
        error: null,
        results: {
          withinBudget: [],
          overBudget: [],
          unavailable: [],
          allRanked: [],
          loopSummaries: [],
          tuningHistory: [],
        },
      };

      runningJobs.add(job.id);
      emitState(job);

      runJob(job)
        .catch((error) => {
          patch(
            job,
            {
              status: 'failed',
              phase: 'finalize',
              completedAt: Date.now(),
              error: {
                code: String(error instanceof Error && error.message.includes('canceled') ? 'CANCELED' : 'INTERNAL_ERROR'),
                message: String(error instanceof Error ? error.message : 'Unexpected in-page engine failure.'),
              },
            },
            false,
          );
          emitState(job);
        })
        .finally(() => {
          runningJobs.delete(job.id);
          canceledJobs.delete(job.id);
        });
    }

    function cancel(message) {
      const jobId = String(message?.jobId || '');
      if (!jobId) return;
      if (runningJobs.has(jobId)) canceledJobs.add(jobId);
    }

    return {
      postMessage(message) {
        if (message?.type === 'start') {
          start(message);
          return;
        }
        if (message?.type === 'cancel') {
          cancel(message);
          return;
        }
        emitError(`Unknown engine command: ${String(message?.type || 'undefined')}`);
      },
      addEventListener(type, handler) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
      },
      removeEventListener(type, handler) {
        if (!listeners[type]) return;
        const idx = listeners[type].indexOf(handler);
        if (idx >= 0) listeners[type].splice(idx, 1);
      },
    };
  }

  function createEngineBridge() {
    try {
      return new Worker('engine.worker.js');
    } catch (error) {
      showFormError('Web Worker is required (no simulation). Use a browser that supports Web Workers.');
      return {
        postMessage: function (msg) {
          if (msg && msg.type === 'start') {
            showJobError('Start disabled: Web Worker unavailable.');
          }
        },
        addEventListener: function () {},
        removeEventListener: function () {},
      };
    }
  }

  function updateStatus(job) {
    currentJob = job;

    const percent = clamp(Math.round(Number(job.progress || 0)), 0, 100);
    statusLabelEl.textContent = phaseLabel(job.status, job.phase);
    progressLabelEl.textContent = `(${percent}%)`;
    loopLabelEl.textContent =
      typeof job.currentLoop === 'number' && typeof job.totalLoops === 'number'
        ? `Loop ${job.currentLoop}/${job.totalLoops}`
        : 'Loop -/-';

    const elapsed = Number(job.updatedAt || 0) - Number(job.startedAt || 0);
    elapsedLabelEl.textContent = `Elapsed: ${formatElapsed(elapsed)}`;

    progressFillEl.style.width = `${percent}%`;
    progressFillEl.parentElement.setAttribute('aria-valuenow', String(percent));
    jobIdEl.textContent = `Run: ${job.id || '-'}`;

    const running = job.status === 'running' || job.status === 'queued';
    startBtn.disabled = running;
    cancelBtn.disabled = !running;

    if (job.error) {
      showJobError(`${job.error.code}: ${job.error.message}`);
      const errorKey = `${job.id || ''}:${job.error.code || ''}:${job.error.message || ''}`;
      if (errorKey !== lastLoggedJobErrorKey) {
        pushDebugLog('app.js:updateStatus', 'Job error', {
          jobId: job.id || null,
          code: job.error.code || 'UNKNOWN',
          message: job.error.message || '',
          phase: job.phase || null,
          progress: Number(job.progress || 0),
        });
        lastLoggedJobErrorKey = errorKey;
      }
    } else {
      showJobError('');
    }

    if (job.results) {
      currentResults = job.results;
      renderResults(currentResults);
    }

    if (job.status === 'done' || job.status === 'failed') {
      latestRunExport = {
        run: cloneForExport(job),
        results: cloneForExport(job.results || currentResults || {}),
      };
      downloadJsonBtn.disabled = !latestRunExport || !latestRunExport.run || !latestRunExport.results;
      startBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  }

  function downloadResultsJson() {
    if (!latestRunExport || !latestRunExport.run || !latestRunExport.results) {
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      run: latestRunExport.run,
      results: latestRunExport.results,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `domainname_wizard_${latestRunExport.run.id || 'run'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleStart() {
    showFormError('');
    showJobError('');
    debugLogs.length = 0;

    const input = collectInput();
    pushDebugLog('app.js:handleStart', 'Run started', {
      apiBaseUrl: input.apiBaseUrl,
      origin: (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '',
      keywordsLength: String(input.keywords || '').length,
      loopCount: input.loopCount,
      maxNames: input.maxNames,
    });
    if (!input.keywords || input.keywords.length < 2) {
      showFormError('Keywords must be at least 2 characters.');
      return;
    }

    resultsPanelEl.hidden = true;
    currentResults = null;
    latestRunExport = null;
    downloadJsonBtn.disabled = true;

    engine.postMessage({ type: 'start', input: input });
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    statusLabelEl.textContent = 'Queued';
    progressLabelEl.textContent = '(0%)';
    loopLabelEl.textContent = 'Loop -/-';
    elapsedLabelEl.textContent = 'Elapsed: 00:00';
    progressFillEl.style.width = '0%';
  }

  const engine = createEngineBridge();

  engine.addEventListener('message', function (event) {
    const message = event.data || {};

    if (message.type === 'debugLog' && message.payload) {
      debugLogs.push(message.payload);
      return;
    }

    if (message.type === 'state' && message.job) {
      updateStatus(message.job);
      return;
    }

    if (message.type === 'error') {
      const details = message.message || 'Unknown worker error.';
      pushDebugLog('app.js:workerMessage', 'Worker error message', {
        jobId: message.jobId || null,
        message: details,
      });
      showFormError(details);
      startBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  });

  engine.addEventListener('error', function (event) {
    const errorMessage = event.message || 'Worker runtime error.';
    pushDebugLog('app.js:workerErrorEvent', 'Worker runtime error', { message: errorMessage });
    showFormError(errorMessage);
    startBtn.disabled = false;
    cancelBtn.disabled = true;
  });

  startBtn.addEventListener('click', function () {
    handleStart();
  });

  cancelBtn.addEventListener('click', function () {
    if (!currentJob || !currentJob.id) {
      return;
    }
    engine.postMessage({ type: 'cancel', jobId: currentJob.id });
  });

  sortModeEl.addEventListener('change', function () {
    currentSortMode = sortModeEl.value || 'marketability';
    if (currentResults) {
      renderResults(currentResults);
    }
  });

  downloadJsonBtn.addEventListener('click', function () {
    downloadResultsJson();
  });

  function downloadDebugLog() {
    const ndjson = debugLogs.map(function (entry) { return JSON.stringify(entry); }).join('\n');
    const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'debug-437d46.log';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const downloadDebugLogLink = document.getElementById('download-debug-log');
  if (downloadDebugLogLink) {
    downloadDebugLogLink.addEventListener('click', function (e) {
      e.preventDefault();
      downloadDebugLog();
    });
  }

})();
