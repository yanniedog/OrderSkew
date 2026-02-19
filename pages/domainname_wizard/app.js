(function () {
  const U = window.DomainNameWizardUtils || {};
  const BACKEND_URL = U.BACKEND_URL != null ? U.BACKEND_URL : '';
  const escapeHtml = U.escapeHtml || (function (input) { const div = document.createElement('div'); div.textContent = input == null ? '' : String(input); return div.innerHTML; });
  const clamp = U.clamp || (function (value, min, max) { return Math.min(max, Math.max(min, value)); });
  const parseNumber = U.parseNumber || (function (value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; });
  const formatMoney = U.formatMoney || (function (value, currency) { if (typeof value !== 'number' || !Number.isFinite(value)) return '-'; return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(value); });
  const formatScore = U.formatScore || (function (value, digits) { if (typeof value !== 'number' || !Number.isFinite(value)) return '-'; return value.toFixed(digits == null ? 1 : digits); });
  const formatElapsed = U.formatElapsed || (function (ms) { if (!Number.isFinite(ms) || ms < 0) return '00:00'; const seconds = Math.floor(ms / 1000); const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remSeconds = seconds % 60; if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remSeconds).padStart(2, '0')}`; return `${String(minutes).padStart(2, '0')}:${String(remSeconds).padStart(2, '0')}`; });
  const phaseLabel = U.phaseLabel || (function (status, phase) { return status || 'Idle'; });

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
  const keywordLibraryTableEl = document.getElementById('keyword-library-table');

  let currentJob = null;
  let currentResults = null;
  let currentSortMode = 'valueRatio';
  const debugLogs = [];
  let lastLoggedJobErrorKey = '';
  let lastLoggedJobStateKey = '';
  let latestRunExport = null;
  const ENGINE_WORKER_VERSION = '2026-02-19-5';
  const tableSortState = new WeakMap();
  let dataSourceCollapsed = true;
  let diagnosticsInFlight = null;
  let diagnosticsDebounceTimer = null;

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

  const dataSourceState = {
    diagnostics: {
      running: false,
      completedAt: null,
      issues: [],
    },
    nameGeneration: null,
    availability: null,
    synonymApi: null,
    githubApi: null,
    godaddyDebug: null,
    syntheticFlags: [],
  };

  function hasDataSourceIssues() {
    const issues = [];
    if (dataSourceState.diagnostics && Array.isArray(dataSourceState.diagnostics.issues)) {
      for (const issue of dataSourceState.diagnostics.issues) issues.push(String(issue));
    }
    if (dataSourceState.synonymApi && !dataSourceState.synonymApi.accessible) issues.push('Synonym API unreachable');
    if (dataSourceState.githubApi && !dataSourceState.githubApi.accessible) issues.push('GitHub API unreachable');
    if (dataSourceState.availability && (dataSourceState.availability.syntheticData || Number(dataSourceState.availability.status || 0) >= 400)) {
      issues.push('Availability API abnormal');
    }
    if (dataSourceState.nameGeneration && dataSourceState.nameGeneration.namelixApiCalled === false && BACKEND_URL) {
      issues.push('Namelix API unavailable');
    }
    return issues;
  }

  function ensureDataSourceExpandedForIssues() {
    const issues = hasDataSourceIssues();
    if (issues.length > 0) dataSourceCollapsed = false;
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(function () { controller.abort(); }, Math.max(500, Number(timeoutMs) || 6000));
    try {
      const response = await fetch(url, { ...(options || {}), signal: controller.signal });
      const json = await response.json().catch(function () { return null; });
      return { response, json };
    } finally {
      clearTimeout(timeout);
    }
  }

  function setDiagnosticsRunning(running) {
    dataSourceState.diagnostics.running = Boolean(running);
    renderDataSourcePanel();
  }

  async function runPreflightDiagnostics(reason) {
    if (diagnosticsInFlight) return diagnosticsInFlight;
    diagnosticsInFlight = (async function () {
      const issues = [];
      setDiagnosticsRunning(true);

      const githubTokenInput = formEl ? formEl.querySelector('input[name="githubToken"]') : null;
      const githubToken = githubTokenInput ? String(githubTokenInput.value || '').trim() : '';
      const backendBaseUrl = String(BACKEND_URL || '').trim().replace(/\/+$/, '');

      // Synonym API (DataMuse)
      try {
        const syn = await fetchJsonWithTimeout('https://api.datamuse.com/words?ml=code&max=1', { method: 'GET' }, 6500);
        const ok = Boolean(syn.response && syn.response.ok && Array.isArray(syn.json));
        dataSourceState.synonymApi = {
          provider: 'datamuse',
          accessible: ok,
          attempted: 1,
          success: ok ? 1 : 0,
          failed: ok ? 0 : 1,
          sampleErrors: ok ? [] : [`HTTP ${syn.response ? syn.response.status : 'n/a'}`],
          source: 'preflight',
        };
        if (!ok) issues.push('Synonym API preflight failed');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'unknown error');
        dataSourceState.synonymApi = {
          provider: 'datamuse',
          accessible: false,
          attempted: 1,
          success: 0,
          failed: 1,
          sampleErrors: [msg],
          source: 'preflight',
        };
        issues.push('Synonym API preflight failed');
      }

      // GitHub API
      try {
        const headers = { Accept: 'application/vnd.github+json' };
        if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
        const gh = await fetchJsonWithTimeout('https://api.github.com/rate_limit', { method: 'GET', headers }, 7000);
        const core = gh.json && gh.json.resources && gh.json.resources.core ? gh.json.resources.core : null;
        const ok = Boolean(gh.response && gh.response.ok && core && typeof core.remaining === 'number');
        const abnormal = ok && core.remaining <= 0;
        dataSourceState.githubApi = {
          provider: 'github',
          accessible: ok && !abnormal,
          status: gh.response ? gh.response.status : null,
          remaining: core ? Number(core.remaining) : null,
          limit: core ? Number(core.limit) : null,
          reset: core ? Number(core.reset) : null,
          tokenUsed: Boolean(githubToken),
          abnormal,
          source: 'preflight',
        };
        if (!ok || abnormal) issues.push('GitHub API preflight abnormal');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err || 'unknown error');
        dataSourceState.githubApi = {
          provider: 'github',
          accessible: false,
          status: null,
          remaining: null,
          limit: null,
          reset: null,
          tokenUsed: Boolean(githubToken),
          abnormal: true,
          source: 'preflight',
          error: msg,
        };
        issues.push('GitHub API preflight failed');
      }

      // Backend APIs (if configured)
      if (backendBaseUrl) {
        try {
          const avail = await fetchJsonWithTimeout(`${backendBaseUrl}/api/domains/availability`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domains: ['example.com'] }),
          }, 7500);
          const hasResults = Boolean(avail.json && avail.json.results && typeof avail.json.results === 'object');
          const ok = Boolean(avail.response && avail.response.ok && hasResults);
          const debug = avail.json && avail.json._debug ? avail.json._debug : null;
          dataSourceState.availability = {
            source: debug && debug.dataSource ? debug.dataSource : 'GoDaddy API',
            endpoint: `${backendBaseUrl}/api/domains/availability`,
            env: debug && debug.godaddyEnv ? debug.godaddyEnv : null,
            credentialsSource: debug && debug.credentialsSource ? debug.credentialsSource : null,
            apiKeyPresent: debug ? debug.apiKeyPresent : null,
            status: avail.response ? avail.response.status : null,
            syntheticData: Boolean(debug && debug.syntheticData),
            resultCount: hasResults ? Object.keys(avail.json.results).length : 0,
            preflight: true,
          };
          if (!ok || dataSourceState.availability.syntheticData) issues.push('Availability API preflight abnormal');
        } catch (err) {
          const msg = err && err.message ? err.message : String(err || 'unknown error');
          dataSourceState.availability = {
            source: 'GoDaddy API',
            endpoint: `${backendBaseUrl}/api/domains/availability`,
            env: null,
            credentialsSource: null,
            apiKeyPresent: null,
            status: null,
            syntheticData: false,
            resultCount: 0,
            preflight: true,
            error: msg,
          };
          issues.push('Availability API preflight failed');
        }

        try {
          const names = await fetchJsonWithTimeout(`${backendBaseUrl}/api/names/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keywords: 'code hub',
              description: '',
              blacklist: '',
              maxLength: 10,
              tld: 'com',
              style: 'default',
              randomness: 'medium',
              maxNames: 1,
              prevNames: [],
              preferEnglish: true,
            }),
          }, 7500);
          const list = names.json && Array.isArray(names.json.names) ? names.json.names : [];
          const ok = Boolean(names.response && names.response.ok && list.length >= 0);
          dataSourceState.nameGeneration = {
            source: ok ? 'Namelix API (preflight)' : 'Name API unavailable',
            namelixApiCalled: ok,
            syntheticNameGeneration: !ok,
            premiumSource: 'GoDaddy API',
            status: names.response ? names.response.status : null,
            resultCount: list.length,
            preflight: true,
          };
          if (!ok) issues.push('Name generation API preflight failed');
        } catch (err) {
          const msg = err && err.message ? err.message : String(err || 'unknown error');
          dataSourceState.nameGeneration = {
            source: 'Name API unavailable',
            namelixApiCalled: false,
            syntheticNameGeneration: true,
            premiumSource: 'GoDaddy API',
            status: null,
            resultCount: 0,
            preflight: true,
            error: msg,
          };
          issues.push('Name generation API preflight failed');
        }
      } else {
        dataSourceState.availability = {
          source: 'Backend not configured',
          endpoint: null,
          env: null,
          credentialsSource: null,
          apiKeyPresent: null,
          status: null,
          syntheticData: false,
          resultCount: 0,
          preflight: true,
        };
        dataSourceState.nameGeneration = {
          source: 'Backend not configured',
          namelixApiCalled: false,
          syntheticNameGeneration: true,
          premiumSource: 'GoDaddy API',
          status: null,
          resultCount: 0,
          preflight: true,
        };
        issues.push('Backend URL not configured');
      }

      dataSourceState.diagnostics.running = false;
      dataSourceState.diagnostics.completedAt = new Date().toISOString();
      dataSourceState.diagnostics.issues = issues;
      pushDebugLog('app.js:runPreflightDiagnostics', 'Data source preflight complete', {
        reason: reason || 'unknown',
        issues: issues.slice(0, 10),
        completedAt: dataSourceState.diagnostics.completedAt,
      });
      ensureDataSourceExpandedForIssues();
      renderDataSourcePanel();
    })().finally(function () {
      diagnosticsInFlight = null;
      dataSourceState.diagnostics.running = false;
    });
    return diagnosticsInFlight;
  }

  function updateDataSourcePanel(payload) {
    if (!payload || !payload.data) return;
    const d = payload.data;
    const msg = payload.message || '';
    let dirty = false;

    if (msg === 'Name generation source' || d.source === 'LOCAL (makeBatch combinatorics)') {
      dataSourceState.nameGeneration = {
        source: d.source || 'LOCAL',
        namelixApiCalled: Boolean(d.namelixApiCalled),
        syntheticNameGeneration: Boolean(d.syntheticNameGeneration),
        premiumSource: d.sampleCandidates && d.sampleCandidates[0] ? d.sampleCandidates[0].premiumSource : 'hash-based',
      };
      if (d.syntheticNameGeneration) {
        dataSourceState.syntheticFlags.push('Name generation is LOCAL (not Namelix API)');
      }
      dirty = true;
    }

    if (msg === 'GoDaddy API debug info' || d.dataSource || d.godaddyEndpoint) {
      dataSourceState.godaddyDebug = d;
      dataSourceState.availability = {
        source: d.dataSource || 'GoDaddy API',
        endpoint: d.godaddyEndpoint || null,
        env: d.godaddyEnv || null,
        credentialsSource: d.credentialsSource || null,
        apiKeyPresent: d.apiKeyPresent,
        status: d.godaddyStatus || null,
        syntheticData: Boolean(d.syntheticData),
      };
      dirty = true;
    }

    if (msg === 'Availability API success response' && d._debug) {
      dataSourceState.godaddyDebug = d._debug;
      dataSourceState.availability = {
        source: d._debug.dataSource || 'GoDaddy API',
        endpoint: d._debug.godaddyEndpoint || d.url,
        env: d._debug.godaddyEnv || null,
        credentialsSource: d._debug.credentialsSource || null,
        apiKeyPresent: d._debug.apiKeyPresent,
        status: d._debug.godaddyStatus || d.status,
        syntheticData: Boolean(d._debug.syntheticData),
        resultCount: d.resultCount,
      };
      dirty = true;
    }

    if (msg === 'Synonym API accessibility') {
      dataSourceState.synonymApi = {
        provider: d.provider || 'synonym_api',
        accessible: Boolean(d.accessible),
        attempted: Number(d.attempted || 0),
        success: Number(d.success || 0),
        failed: Number(d.failed || 0),
        sampleErrors: Array.isArray(d.sampleErrors) ? d.sampleErrors.slice(0, 5) : [],
      };
      dirty = true;
    }

    if (!dirty) return;
    ensureDataSourceExpandedForIssues();
    renderDataSourcePanel();
  }

  function captureResultsScrollState() {
    const ids = [
      'all-ranked-table',
      'within-budget-table',
      'over-budget-table',
      'unavailable-table',
      'loop-summary-table',
      'keyword-library-table',
      'tuning-table',
    ];
    const wrapScroll = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) wrapScroll[id] = el.scrollTop || 0;
    }
    return { pageY: window.scrollY || 0, wrapScroll };
  }

  function restoreResultsScrollState(state) {
    if (!state || typeof state !== 'object') return;
    const wrapScroll = state.wrapScroll || {};
    for (const [id, top] of Object.entries(wrapScroll)) {
      const el = document.getElementById(id);
      if (el) el.scrollTop = Number(top) || 0;
    }
    window.scrollTo(0, Number(state.pageY) || 0);
  }

  function renderDataSourcePanel() {
    const el = document.getElementById('data-source-panel');
    if (!el) return;
    el.hidden = false;

    const parts = [];
    const bodyParts = [];

    parts.push('<button type="button" id="data-source-toggle" class="ds-toggle" aria-expanded="' + (!dataSourceCollapsed ? 'true' : 'false') + '">Data Source Confirmation</button>');
    if (dataSourceState.diagnostics && dataSourceState.diagnostics.running) {
      bodyParts.push('<div class="ds-block"><strong>Diagnostics:</strong> <span class="warn">Running preflight checks...</span></div>');
    } else if (dataSourceState.diagnostics && dataSourceState.diagnostics.completedAt) {
      bodyParts.push('<div class="ds-block"><strong>Diagnostics:</strong> Last completed at <code>' + escapeHtml(dataSourceState.diagnostics.completedAt) + '</code></div>');
    }

    if (dataSourceState.nameGeneration) {
      const ng = dataSourceState.nameGeneration;
      const cls = ng.namelixApiCalled ? 'good' : 'warn';
      bodyParts.push('<div class="ds-block">');
      bodyParts.push('<strong>Name Generation:</strong> ');
      bodyParts.push('<span class="' + cls + '">' + escapeHtml(ng.source) + '</span>');
      bodyParts.push('<br>Namelix API called: <strong>' + (ng.namelixApiCalled ? 'YES' : 'NO') + '</strong>');
      bodyParts.push('<br>Premium pricing source: <strong>GoDaddy API</strong>');
      if (ng.syntheticNameGeneration) {
        bodyParts.push('<br><span class="warn">Names are generated locally, not from Namelix.</span>');
      }
      if (ng.status != null) bodyParts.push('<br>HTTP status: <strong>' + escapeHtml(String(ng.status)) + '</strong>');
      if (ng.resultCount != null) bodyParts.push('<br>Results returned: <strong>' + escapeHtml(String(ng.resultCount)) + '</strong>');
      if (ng.error) bodyParts.push('<br><span class="bad">Error: ' + escapeHtml(String(ng.error)) + '</span>');
      bodyParts.push('</div>');
    }

    if (dataSourceState.availability) {
      const av = dataSourceState.availability;
      const cls = av.syntheticData ? 'bad' : 'good';
      bodyParts.push('<div class="ds-block">');
      bodyParts.push('<strong>Availability &amp; Pricing:</strong> ');
      bodyParts.push('<span class="' + cls + '">' + escapeHtml(av.source || 'Unknown') + '</span>');
      if (av.endpoint) bodyParts.push('<br>Endpoint: <code>' + escapeHtml(av.endpoint) + '</code>');
      if (av.env) bodyParts.push('<br>GoDaddy Environment: <strong>' + escapeHtml(av.env) + '</strong>');
      if (av.credentialsSource) bodyParts.push('<br>Credentials from: <strong>' + escapeHtml(av.credentialsSource) + '</strong>');
      bodyParts.push('<br>API Key present: <strong>' + (av.apiKeyPresent ? 'YES' : 'NO') + '</strong>');
      if (av.status) bodyParts.push('<br>GoDaddy response status: <strong>' + escapeHtml(String(av.status)) + '</strong>');
      if (av.resultCount != null) bodyParts.push('<br>Results returned: <strong>' + av.resultCount + '</strong>');
      bodyParts.push('<br>Synthetic data: <strong class="' + (av.syntheticData ? 'bad' : 'good') + '">' + (av.syntheticData ? 'YES' : 'NO') + '</strong>');
      if (av.error) bodyParts.push('<br><span class="bad">Error: ' + escapeHtml(String(av.error)) + '</span>');
      bodyParts.push('</div>');
    }

    if (dataSourceState.synonymApi) {
      const syn = dataSourceState.synonymApi;
      bodyParts.push('<div class="ds-block">');
      bodyParts.push('<strong>Synonym APIs:</strong> ');
      bodyParts.push('<span class="' + (syn.accessible ? 'good' : 'bad') + '">' + (syn.accessible ? 'ACCESSIBLE' : 'UNREACHABLE') + '</span>');
      bodyParts.push('<br>Provider: <strong>' + escapeHtml(String(syn.provider || 'unknown')) + '</strong>');
      bodyParts.push('<br>Successful calls: <strong>' + syn.success + '</strong> / ' + syn.attempted);
      bodyParts.push('<br>Failed calls: <strong>' + syn.failed + '</strong>');
      if (syn.sampleErrors && syn.sampleErrors.length) {
        bodyParts.push('<br>Sample errors:<ul class="ds-errors">');
        for (const err of syn.sampleErrors) bodyParts.push('<li>' + escapeHtml(String(err)) + '</li>');
        bodyParts.push('</ul>');
      }
      bodyParts.push('</div>');
    }

    if (dataSourceState.githubApi) {
      const gh = dataSourceState.githubApi;
      const cls = gh.accessible ? 'good' : 'bad';
      bodyParts.push('<div class="ds-block">');
      bodyParts.push('<strong>GitHub API:</strong> ');
      bodyParts.push('<span class="' + cls + '">' + (gh.accessible ? 'ACCESSIBLE' : 'UNREACHABLE') + '</span>');
      bodyParts.push('<br>Provider: <strong>github.com</strong>');
      if (gh.status != null) bodyParts.push('<br>HTTP status: <strong>' + escapeHtml(String(gh.status)) + '</strong>');
      bodyParts.push('<br>Auth token used: <strong>' + (gh.tokenUsed ? 'YES' : 'NO') + '</strong>');
      if (gh.limit != null) bodyParts.push('<br>Rate limit: <strong>' + gh.remaining + '</strong> / ' + gh.limit);
      if (gh.error) bodyParts.push('<br><span class="bad">Error: ' + escapeHtml(String(gh.error)) + '</span>');
      if (gh.abnormal) bodyParts.push('<br><span class="warn">Abnormal result detected.</span>');
      bodyParts.push('</div>');
    }

    if (dataSourceState.godaddyDebug && dataSourceState.godaddyDebug.sampleRawResponse) {
      bodyParts.push('<div class="ds-block">');
      bodyParts.push('<strong>Sample GoDaddy Raw Response:</strong><br>');
      bodyParts.push('<pre style="font-size:0.75rem;overflow-x:auto;max-width:100%;">' + escapeHtml(JSON.stringify(dataSourceState.godaddyDebug.sampleRawResponse, null, 2)) + '</pre>');
      bodyParts.push('</div>');
    }

    if (dataSourceState.syntheticFlags.length > 0) {
      bodyParts.push('<div class="ds-block warn-block">');
      bodyParts.push('<strong>Synthetic/Simulated Data Warnings:</strong><ul>');
      dataSourceState.syntheticFlags.forEach(function (f) {
        bodyParts.push('<li>' + escapeHtml(f) + '</li>');
      });
      bodyParts.push('</ul></div>');
    }
    const currentIssues = hasDataSourceIssues();
    if (currentIssues.length > 0) {
      bodyParts.push('<div class="ds-block warn-block">');
      bodyParts.push('<strong>Service Issues:</strong><ul>');
      currentIssues.forEach(function (f) {
        bodyParts.push('<li>' + escapeHtml(f) + '</li>');
      });
      bodyParts.push('</ul></div>');
    }

    parts.push('<div id="data-source-body"' + (dataSourceCollapsed ? ' hidden' : '') + '>' + bodyParts.join('') + '</div>');
    el.innerHTML = parts.join('');
    const toggle = document.getElementById('data-source-toggle');
    const body = document.getElementById('data-source-body');
    if (toggle && body) {
      toggle.addEventListener('click', function () {
        dataSourceCollapsed = !dataSourceCollapsed;
        toggle.setAttribute('aria-expanded', dataSourceCollapsed ? 'false' : 'true');
        body.hidden = dataSourceCollapsed;
      });
    }
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
        if ((a.financialValueScore || 0) !== (b.financialValueScore || 0)) return (b.financialValueScore || 0) - (a.financialValueScore || 0);
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'intrinsicValue') {
        if ((a.intrinsicValue || 0) !== (b.intrinsicValue || 0)) return (b.intrinsicValue || 0) - (a.intrinsicValue || 0);
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'estimatedValue') {
        if ((a.estimatedValueUSD || 0) !== (b.estimatedValueUSD || 0)) return (b.estimatedValueUSD || 0) - (a.estimatedValueUSD || 0);
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'valueRatio') {
        if ((a.valueRatio || 0) !== (b.valueRatio || 0)) return (b.valueRatio || 0) - (a.valueRatio || 0);
        return (b.estimatedValueUSD || 0) - (a.estimatedValueUSD || 0);
      }
      if (mode === 'expectedValue') {
        if ((a.ev24m || 0) !== (b.ev24m || 0)) return (b.ev24m || 0) - (a.ev24m || 0);
        return (b.estimatedValueUSD || 0) - (a.estimatedValueUSD || 0);
      }
      if (mode === 'liquidityScore') {
        if ((a.liquidityScore || 0) !== (b.liquidityScore || 0)) return (b.liquidityScore || 0) - (a.liquidityScore || 0);
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'devEcosystem') {
        if ((a.devEcosystemScore || 0) !== (b.devEcosystemScore || 0)) return (b.devEcosystemScore || 0) - (a.devEcosystemScore || 0);
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'alphabetical') {
        const alpha = String(a.domain || '').localeCompare(String(b.domain || ''));
        if (alpha !== 0) return alpha;
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'syllableCount') {
        if ((a.syllableCount || 0) !== (b.syllableCount || 0)) return (a.syllableCount || 0) - (b.syllableCount || 0);
        return compareOverallTieBreak(a, b);
      }
      if (mode === 'labelLength') {
        if ((a.labelLength || 0) !== (b.labelLength || 0)) return (a.labelLength || 0) - (b.labelLength || 0);
        return compareOverallTieBreak(a, b);
      }
      if ((a.marketabilityScore || 0) !== (b.marketabilityScore || 0)) return (b.marketabilityScore || 0) - (a.marketabilityScore || 0);
      return compareOverallTieBreak(a, b);
    });
    return copy;
  }

  function th(label, tooltip) {
    return `<th title="${escapeHtml(String(tooltip || ''))}">${escapeHtml(String(label || ''))}</th>`;
  }

  function normalizePerfToken(token) {
    return String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function rainbowColorForScore01(score01) {
    const s = clamp(Number(score01) || 0, 0, 1);
    const hue = Math.round(240 - 240 * s);
    return `hsl(${hue}, 88%, 48%)`;
  }

  function buildTokenPerformanceLookup(keywordLibrary) {
    const lib = keywordLibrary || {};
    const rows = Array.isArray(lib.tokens) ? lib.tokens : [];
    const out = new Map();
    for (const row of rows) {
      const key = normalizePerfToken(row && row.token);
      if (!key) continue;
      const perf = Number(row.performanceScore);
      const perf01 = Number.isFinite(perf) ? clamp(perf / 100, 0, 1) : clamp(Number(row.avgReward) || 0, 0, 1);
      out.set(key, {
        performanceScore: Number.isFinite(perf) ? perf : perf01 * 100,
        avgReward: Number(row.avgReward) || 0,
        plays: Math.max(0, Number(row.plays) || 0),
        selectionScore: Number(row.selectionScore) || 0,
        successRate: Number(row.successRate) || 0,
        confidence: Number(row.confidence) || 0,
      });
    }
    return out;
  }

  function renderPerformancePhrase(text, perfLookup) {
    const raw = String(text || '').trim();
    if (!raw) return '-';
    if (!(perfLookup instanceof Map) || perfLookup.size === 0) return escapeHtml(raw);

    const parts = raw.split(/(\s+)/);
    return parts.map(function (part) {
      if (!part || /^\s+$/.test(part)) return part;
      const key = normalizePerfToken(part);
      if (!key || !perfLookup.has(key)) return escapeHtml(part);
      const m = perfLookup.get(key);
      const perf01 = clamp((Number(m.performanceScore) || 0) / 100, 0, 1);
      const color = rainbowColorForScore01(perf01);
      const title = [
        `Perf ${formatScore(m.performanceScore, 1)}`,
        `AvgReward ${formatScore(m.avgReward, 3)}`,
        `Success ${formatScore((m.successRate || 0) * 100, 1)}%`,
        `Plays ${Math.round(m.plays || 0)}`,
      ].join(' | ');
      return `<span class="perf-token" style="background:${color}" title="${escapeHtml(title)}">${escapeHtml(part)}</span>`;
    }).join('');
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
    const overBudgetCount = (results.overBudget || []).length;
    const underpricedCount = allRanked.filter(r => r.underpricedFlag).length;
    const avgEstValue = allRanked.filter(r => r.estimatedValueUSD > 0).reduce((s, r) => s + r.estimatedValueUSD, 0) / Math.max(1, allRanked.filter(r => r.estimatedValueUSD > 0).length);
    const bestRatio = allRanked.reduce((best, r) => Math.max(best, r.valueRatio || 0), 0);

    summaryKpisEl.innerHTML = [
      { label: 'Ranked Domains', value: String(allRanked.length) },
      { label: 'Within Budget', value: String(positiveBudget) },
      { label: 'Underpriced', value: String(underpricedCount) },
      { label: 'Avg Est. Value', value: avgEstValue > 0 ? '$' + Math.round(avgEstValue).toLocaleString() : '-' },
      { label: 'Best Value Ratio', value: bestRatio > 0 ? formatScore(bestRatio, 1) + 'x' : '-' },
      { label: 'Avg Intrinsic', value: formatScore(avg('intrinsicValue'), 1) },
      { label: 'Avg Liquidity', value: formatScore(avg('liquidityScore'), 0) },
      { label: 'Top Domain', value: top ? escapeHtml(top.domain) : '-' },
    ]
      .map((item) => `<article class="summary-card"><span>${item.label}</span><strong>${item.value}</strong></article>`)
      .join('');
  }

  function renderDomainTable(rows, includeAvailability) {
    if (!rows || rows.length === 0) {
      return '<p>No rows.</p>';
    }

    const availabilityHeader = includeAvailability ? th('Availability', 'Current availability status for this domain based on API response.') : '';
    const availabilityCell = (row) => {
      if (!includeAvailability) return '';
      return `<td class="${row.available ? 'good' : 'bad'}">${row.available ? 'Available' : 'Unavailable'}</td>`;
    };

    const body = rows
      .map((row) => {
        const priceCell = row._pending ? '...' : formatMoney(row.price, row.currency);
        const estVal = row.estimatedValueUSD ? '$' + Number(row.estimatedValueUSD).toLocaleString() : '-';
        const vrCell = row.valueRatio != null ? formatScore(row.valueRatio, 1) + 'x' : '-';
        const flagCell = row.underpricedFlag ? '<span class="underpriced-badge">' + escapeHtml(row.underpricedFlag.replace(/_/g, ' ')) + '</span>' : '';
        const valueCell = [
          `I:${formatScore(row.intrinsicValue, 1)}`,
          `L:${row.liquidityScore != null ? formatScore(row.liquidityScore, 0) : '-'}`,
          `M:${formatScore(row.marketabilityScore, 1)}`,
        ].join(' | ');
        const financeCell = [
          `EV:${row.ev24m != null ? '$' + Number(row.ev24m).toLocaleString() : '-'}`,
          `ROI:${row.expectedROI != null ? formatScore(row.expectedROI, 1) + '%' : '-'}`,
        ].join(' | ');
        const qualityCell = [
          `P:${formatScore(row.phoneticScore, 1)}`,
          `B:${formatScore(row.brandabilityScore, 1)}`,
          `S:${formatScore(row.seoScore, 1)}`,
          `C:${formatScore(row.commercialScore || 0, 1)}`,
        ].join(' | ');
        const signalsCell = [
          `Dev:${row.devEcosystemScore > 0 ? Number(row.devEcosystemScore).toLocaleString() : '-'}`,
          `Arc:${row.hasArchiveHistory ? 'Y' : 'N'}`,
          `Syl:${Number(row.syllableCount || 0)}`,
          `Len:${Number(row.labelLength || 0)}`,
        ].join(' | ');
        const wordsCell = (row.segmentedWords || []).join(' + ') || '-';
        const notes = [
          (row.valueDrivers || []).slice(0, 2).map((x) => `${x.component} (${formatScore(x.impact, 1)})`).join(', '),
          (row.valueDetractors || []).slice(0, 2).map((x) => `${x.component} (${formatScore(x.impact, 1)})`).join(', '),
        ].filter(Boolean).join(' | ');
        return `
          <tr class="${row.underpricedFlag ? 'underpriced-row' : ''}">
            <td>${escapeHtml(row.domain)} ${flagCell}</td>
            ${availabilityCell(row)}
            <td>${priceCell}</td>
            <td>${estVal}</td>
            <td class="${row.valueRatio >= 3 ? 'good' : ''}">${vrCell}</td>
            <td>${valueCell}</td>
            <td>${financeCell}</td>
            <td>${qualityCell}</td>
            <td>${signalsCell}</td>
            <td>${escapeHtml(wordsCell)}</td>
            <td>${escapeHtml(notes || '-')}</td>
          </tr>
        `;
      })
      .join('');

    return `
      <table>
        <thead>
          <tr>
            ${th('Domain', 'The full candidate domain name including TLD.')}
            ${availabilityHeader}
            ${th('Price', 'Year-1 registration price from availability provider.')}
            ${th('Est. Value', 'Model-estimated resale value in USD.')}
            ${th('Value Ratio', 'Estimated value divided by current price; higher suggests more upside.')}
            ${th('Value Metrics', 'Compact view: Intrinsic, Liquidity, and Marketability.')}
            ${th('Finance', 'Compact view: EV (24m) and expected ROI.')}
            ${th('Quality', 'Compact view: Phonetic, Brandability, SEO, Commercial.')}
            ${th('Signals', 'Compact view: Dev signal, archive flag, syllables, length.')}
            ${th('Words', 'Detected meaningful morphemes/word segments in the domain label.')}
            ${th('Notes', 'Top positive and negative value factors (trimmed).')}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function renderLoopSummaryTable(rows, tokenPerfLookup) {
    if (!rows || rows.length === 0) {
      return '<p>No loop summaries yet.</p>';
    }

    return `
      <table>
        <thead>
          <tr>
            ${th('Loop', 'Loop index within the current search run.')}
            ${th('Keywords', 'Keywords used by this loop. Tokens are colored by learned term performance (blue low -> red high).')}
            ${th('Strategy', 'Style, randomness, and mutation used in this loop.')}
            ${th('Explore', 'Exploration rate and elite pool size for this loop.')}
            ${th('Quota', 'Required and available names for this loop.')}
            ${th('Results', 'Considered candidates and average score for this loop.')}
            ${th('Top', 'Top domain and top score for this loop.')}
            ${th('Source/Note', 'Name source and any skip note for this loop.')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `
              <tr>
                <td>${row.loop}</td>
                <td>${renderPerformancePhrase(row.keywords || '-', tokenPerfLookup)}</td>
                <td>${escapeHtml(`${row.style || '-'} | ${row.randomness || '-'} | ${row.mutationIntensity || '-'}`)}</td>
                <td>${escapeHtml(`r=${formatScore(row.explorationRate, 3)} | elite=${Number(row.elitePoolSize || 0)}`)}</td>
                <td>${row.quotaMet ? '<span class="good">' : '<span class="bad">'}${escapeHtml(`${Number(row.requiredQuota || 0)} -> ${Number(row.availableCount || 0)}`)}</span></td>
                <td>${escapeHtml(`n=${Number(row.consideredCount || 0)} | avg=${formatScore(row.averageOverallScore, 2)}`)}</td>
                <td>${escapeHtml(`${row.topDomain || '-'} | ${formatScore(row.topScore, 1)}`)}</td>
                <td>${escapeHtml(`${row.nameSource || '-'} | ${row.skipReason || '-'}`)}</td>
              </tr>
            `)
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderTuningTable(rows, tokenPerfLookup) {
    if (!rows || rows.length === 0) {
      return '<p>No tuning history yet.</p>';
    }

    return `
      <table>
        <thead>
          <tr>
            ${th('Loop', 'Loop index where this tuning decision was recorded.')}
            ${th('Keywords', 'Keyword set chosen for this loop. Tokens are colored by learned performance.')}
            ${th('Strategy', 'Source loop and selected style/randomness/mutation.')}
            ${th('Explore', 'Exploration rate and elite pool at decision time.')}
            ${th('Reward', 'Loop reward assigned by RL objective (0-1).')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `
              <tr>
                <td>${row.loop}</td>
                <td>${renderPerformancePhrase(row.keywords || '-', tokenPerfLookup)}</td>
                <td>${escapeHtml(`src=${row.sourceLoop == null ? '-' : row.sourceLoop} | ${row.selectedStyle || '-'} | ${row.selectedRandomness || '-'} | ${row.selectedMutationIntensity || '-'}`)}</td>
                <td>${escapeHtml(`r=${formatScore(row.explorationRate, 3)} | elite=${Number(row.elitePoolSize || 0)}`)}</td>
                <td>${formatScore(row.reward, 4)}</td>
              </tr>
            `)
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderKeywordLibraryTable(keywordLibrary) {
    const lib = keywordLibrary || {};
    const rows = Array.isArray(lib.tokens) ? lib.tokens : [];
    const current = Array.isArray(lib.currentKeywords) ? lib.currentKeywords : [];
    const seeds = Array.isArray(lib.seedTokens) ? lib.seedTokens : [];

    if (!rows.length) {
      return '<p>No keyword library metrics yet.</p>';
    }

    const seedBadge = seeds.length ? `<p class="keyword-library-meta"><strong>Seeds:</strong> ${escapeHtml(seeds.join(', '))}</p>` : '';
    const activeBadge = current.length ? `<p class="keyword-library-meta"><strong>Current loop keywords:</strong> ${escapeHtml(current.join(' '))}</p>` : '';
    const body = rows.map(function (row) {
      const perf01 = clamp((Number(row.performanceScore) || 0) / 100, 0, 1);
      const wordColor = rainbowColorForScore01(perf01);
      const wordTitle = `Perf ${formatScore(row.performanceScore || 0, 1)} | AvgReward ${formatScore(row.avgReward || 0, 3)} | Success ${formatScore((row.successRate || 0) * 100, 1)}% | Plays ${row.plays || 0}`;
      return `
        <tr${row.inCurrentKeywords ? ' class="keyword-row-active"' : ''}>
          <td>${row.rank || '-'}</td>
          <td><span class="perf-token" style="background:${wordColor}" title="${escapeHtml(wordTitle)}">${escapeHtml(row.token || '-')}</span></td>
          <td>${escapeHtml(`${row.source || '-'} | ${row.inCurrentKeywords ? 'active' : 'idle'}`)}</td>
          <td>${escapeHtml(`plays=${row.plays || 0} | avg=${formatScore(row.avgReward || 0, 4)} | succ=${formatScore((row.successRate || 0) * 100, 1)}%`)}</td>
          <td>${escapeHtml(`conf=${formatScore((row.confidence || 0) * 100, 1)}% | dom=${formatScore(row.meanDomainScore || 0, 1)} | perf=${formatScore(row.performanceScore || 0, 1)} | sel=${formatScore(row.selectionScore || 0, 1)} | ucb=${row.ucb == null ? '-' : formatScore(row.ucb, 4)} | theme=${formatScore(row.themeScore || 0, 2)}`)}</td>
          <td>${row.lastLoop == null ? '-' : row.lastLoop}</td>
        </tr>
      `;
    }).join('');

    return `
      ${seedBadge}
      ${activeBadge}
      <table>
        <thead>
          <tr>
            ${th('Rank', 'Ranking order in the current curated keyword library view.')}
            ${th('Word', 'Keyword token. Color shows learned performance (blue worst -> red best).')}
            ${th('State', 'Source and whether token is active in current loop keywords.')}
            ${th('Usage', 'Core usage metrics: plays, average reward, success rate.')}
            ${th('Evidence', 'Confidence and composite evidence metrics used for RL prioritization.')}
            ${th('Last Loop', 'Most recent loop index where this token was selected.')}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function renderResults(results) {
    if (!results) {
      resultsPanelEl.hidden = true;
      return;
    }
    const scrollState = captureResultsScrollState();

    const allRanked = results.allRanked || [];
    const pending = results.pending || [];
    const pendingRows = pending.map(function (p) {
      const label = String(p.domain || '').split('.')[0];
      return {
        domain: p.domain,
        sourceName: p.sourceName,
        premiumPricing: Boolean(p.premiumPricing),
        available: null,
        price: undefined,
        overBudget: false,
        intrinsicValue: 0,
        marketabilityScore: 0,
        financialValueScore: 0,
        phoneticScore: 0,
        brandabilityScore: 0,
        seoScore: 0,
        commercialScore: 0,
        memorabilityScore: 0,
        overallScore: 0,
        syllableCount: 0,
        labelLength: label.length,
        timesDiscovered: 0,
        firstSeenLoop: 0,
        lastSeenLoop: 0,
        estimatedValueUSD: 0,
        estimatedValueLow: 0,
        estimatedValueHigh: 0,
        valueRatio: null,
        underpricedFlag: null,
        liquidityScore: 0,
        ev24m: 0,
        expectedROI: null,
        devEcosystemScore: 0,
        hasArchiveHistory: false,
        segmentedWords: [],
        valueDrivers: [],
        valueDetractors: [],
        _pending: true,
      };
    });
    const combinedRanked = allRanked.concat(pendingRows);
    const sortedRanked = sortRows(combinedRanked, currentSortMode);
    const withinBudget = sortRows(results.withinBudget || [], currentSortMode);
    const overBudget = sortRows(results.overBudget || [], currentSortMode);
    const unavailable = sortRows(results.unavailable || [], currentSortMode);
    const tokenPerfLookup = buildTokenPerformanceLookup(results.keywordLibrary || null);

    renderSummary(results);
    allRankedTableEl.innerHTML = renderDomainTable(sortedRanked, false);
    withinBudgetTableEl.innerHTML = renderDomainTable(withinBudget, false);
    overBudgetTableEl.innerHTML = renderDomainTable(overBudget, false);
    unavailableTableEl.innerHTML = renderDomainTable(unavailable, true);

    loopSummaryTableEl.innerHTML = renderLoopSummaryTable(results.loopSummaries || [], tokenPerfLookup);
    tuningTableEl.innerHTML = renderTuningTable(results.tuningHistory || [], tokenPerfLookup);
    if (keywordLibraryTableEl) keywordLibraryTableEl.innerHTML = renderKeywordLibraryTable(results.keywordLibrary || null);
    wireTableSorting();
    restoreResultsScrollState(scrollState);

    resultsPanelEl.hidden = false;
  }

  function toggleTableSection(toggleButton) {
    if (!toggleButton) return;
    const section = toggleButton.closest('[data-table-section]');
    if (!section) return;
    const panelId = toggleButton.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : section.querySelector('.table-section-panel');
    if (!panel) return;
    const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
    toggleButton.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    panel.hidden = expanded;
    section.classList.toggle('is-collapsed', expanded);
  }

  function initTableSections() {
    const toggles = document.querySelectorAll('[data-table-toggle]');
    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleTableSection(btn);
      });
    });
  }

  function parseSortValue(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text || text === '-' || text === '...') return { kind: 'text', value: '' };
    const normalized = text.replace(/[$,%x,\s]/gi, '');
    if (/^-?\d+(\.\d+)?$/.test(normalized)) {
      const num = Number(normalized);
      if (Number.isFinite(num)) return { kind: 'number', value: num };
    }
    return { kind: 'text', value: text.toLowerCase() };
  }

  function sortTableByColumn(table, columnIndex) {
    if (!table || !table.tBodies || !table.tBodies[0]) return;
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);
    if (rows.length < 2) return;

    const prev = tableSortState.get(table) || { index: -1, dir: 'desc' };
    const nextDir = prev.index === columnIndex && prev.dir === 'desc' ? 'asc' : 'desc';
    tableSortState.set(table, { index: columnIndex, dir: nextDir });

    const factor = nextDir === 'asc' ? 1 : -1;
    rows.sort(function (ra, rb) {
      const aCell = ra.cells[columnIndex];
      const bCell = rb.cells[columnIndex];
      const a = parseSortValue(aCell ? aCell.textContent : '');
      const b = parseSortValue(bCell ? bCell.textContent : '');
      if (a.kind === 'number' && b.kind === 'number') {
        if (a.value !== b.value) return (a.value - b.value) * factor;
      } else {
        if (a.value !== b.value) return String(a.value).localeCompare(String(b.value)) * factor;
      }
      return String(ra.cells[0] ? ra.cells[0].textContent : '').localeCompare(String(rb.cells[0] ? rb.cells[0].textContent : ''));
    });

    const ths = table.querySelectorAll('thead th');
    ths.forEach(function (th, idx) {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (idx === columnIndex) th.classList.add(nextDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    });

    const frag = document.createDocumentFragment();
    rows.forEach(function (row) { frag.appendChild(row); });
    tbody.appendChild(frag);
  }

  function wireTableSorting() {
    const tables = resultsPanelEl.querySelectorAll('.table-wrap table');
    tables.forEach(function (table) {
      if (table.dataset.sortWired === '1') return;
      table.dataset.sortWired = '1';
      const ths = table.querySelectorAll('thead th');
      ths.forEach(function (th, idx) {
        th.classList.add('sortable');
        th.setAttribute('role', 'button');
        th.setAttribute('tabindex', '0');
        const runSort = function () { sortTableByColumn(table, idx); };
        th.addEventListener('click', runSort);
        th.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            runSort();
          }
        });
      });
    });
  }

  function collectInput() {
    const data = new FormData(formEl);
    return {
      keywords: String(data.get('keywords') || '').trim(),
      description: String(data.get('description') || '').trim(),
      style: String(data.get('style') || 'default'),
      randomness: String(data.get('randomness') || 'medium'),
      blacklist: String(data.get('blacklist') || '').trim(),
      maxLength: clamp(Math.round(parseNumber(data.get('maxLength'), 10)), 5, 25),
      tld: String(data.get('tld') || 'com').trim(),
      maxNames: clamp(Math.round(parseNumber(data.get('maxNames'), 20)), 1, 250),
      yearlyBudget: clamp(parseNumber(data.get('yearlyBudget'), 50), 1, 100000),
      loopCount: clamp(Math.round(parseNumber(data.get('loopCount'), 30)), 1, 60),
      apiBaseUrl: BACKEND_URL,
      githubToken: String(data.get('githubToken') || '').trim(),
      preferEnglish: String(data.get('preferEnglish') || '').toLowerCase() === 'on',
    };
  }

  /* createInPageEngine was removed: it generated fully synthetic/simulated
     domain availability and pricing data using local heuristics (no real API calls).
     The worker (engine.worker.js) now handles all processing with real GoDaddy API data.
     See git history for the original 600+ line implementation. */

  function createEngineBridge() {
    try {
      return new Worker(`engine.worker.js?v=${encodeURIComponent(ENGINE_WORKER_VERSION)}`);
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

    const stateKey = [
      job.id || '',
      job.status || '',
      job.phase || '',
      Number(job.currentLoop || 0),
      Number(job.totalLoops || 0),
      Number(job.progress || 0),
    ].join('|');
    if (stateKey !== lastLoggedJobStateKey) {
      pushDebugLog('app.js:updateStatus', 'Job state', {
        jobId: job.id || null,
        status: job.status || null,
        phase: job.phase || null,
        progress: Number(job.progress || 0),
        currentLoop: Number(job.currentLoop || 0),
        totalLoops: Number(job.totalLoops || 0),
      });
      lastLoggedJobStateKey = stateKey;
    }

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
    lastLoggedJobStateKey = '';
    lastLoggedJobErrorKey = '';
    dataSourceState.godaddyDebug = null;
    dataSourceState.syntheticFlags = [];
    ensureDataSourceExpandedForIssues();
    renderDataSourcePanel();

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
      updateDataSourcePanel(message.payload);
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
    runPreflightDiagnostics('before-start').finally(function () {
      handleStart();
    });
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
    const exportLogs = debugLogs.slice();
    if (latestRunExport && latestRunExport.run && latestRunExport.run.error) {
      exportLogs.push({
        sessionId: '437d46',
        location: 'app.js:downloadDebugLog',
        message: 'Exported run error summary',
        data: {
          jobId: latestRunExport.run.id || null,
          code: latestRunExport.run.error.code || 'UNKNOWN',
          message: latestRunExport.run.error.message || '',
          status: latestRunExport.run.status || null,
          phase: latestRunExport.run.phase || null,
        },
        timestamp: Date.now(),
      });
    }
    const ndjson = exportLogs.map(function (entry) { return JSON.stringify(entry); }).join('\n');
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

  initTableSections();
  if (formEl) {
    const githubInput = formEl.querySelector('input[name="githubToken"]');
    if (githubInput) {
      githubInput.addEventListener('input', function () {
        if (diagnosticsDebounceTimer) clearTimeout(diagnosticsDebounceTimer);
        diagnosticsDebounceTimer = setTimeout(function () {
          runPreflightDiagnostics('github-token-change');
        }, 600);
      });
    }
  }
  runPreflightDiagnostics('initial-load');

})();
