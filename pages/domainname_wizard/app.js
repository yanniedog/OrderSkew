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
  let lastLoggedJobStateKey = '';
  let latestRunExport = null;
  const ENGINE_WORKER_VERSION = '2026-02-18-2';

  const BACKEND_URL = (function () {
    if (typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol || '') && window.location.origin) {
      return window.location.origin;
    }
    return '';
  })();

  (function setRepoUpdatedDatetime() {
    const el = document.getElementById('repo-updated-datetime');
    if (!el) return;
    const raw = typeof document.lastModified === 'string' && document.lastModified ? document.lastModified : '';
    if (!raw) return;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return;
    const pad = function (n) { return String(n).padStart(2, '0'); };
    el.textContent = '(' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ')';
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
    if (status === 'running' && phase === 'namelix') return 'Generating names via Namelix';
    if (status === 'running' && phase === 'godaddy') return 'Checking availability (GoDaddy or RDAP)';
    if (status === 'running' && phase === 'rdap') return 'Checking availability (RDAP)â€¦';
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

  const dataSourceState = {
    nameGeneration: null,
    availability: null,
    godaddyDebug: null,
    syntheticFlags: [],
  };

  function updateDataSourcePanel(payload) {
    if (!payload || !payload.data) return;
    const d = payload.data;
    const msg = payload.message || '';

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
    }

    renderDataSourcePanel();
  }

  function renderDataSourcePanel() {
    const el = document.getElementById('data-source-panel');
    if (!el) return;
    el.hidden = false;

    const parts = [];

    parts.push('<h3>Data Source Confirmation</h3>');

    if (dataSourceState.nameGeneration) {
      const ng = dataSourceState.nameGeneration;
      const cls = ng.namelixApiCalled ? 'good' : 'warn';
      parts.push('<div class="ds-block">');
      parts.push('<strong>Name Generation:</strong> ');
      parts.push('<span class="' + cls + '">' + escapeHtml(ng.source) + '</span>');
      parts.push('<br>Namelix API called: <strong>' + (ng.namelixApiCalled ? 'YES' : 'NO') + '</strong>');
      parts.push('<br>Premium flag source: <strong>' + escapeHtml(ng.premiumSource || 'unknown') + '</strong>');
      if (ng.syntheticNameGeneration) {
        parts.push('<br><span class="warn">Names are generated locally, not from Namelix.</span>');
      }
      parts.push('</div>');
    }

    if (dataSourceState.availability) {
      const av = dataSourceState.availability;
      const cls = av.syntheticData ? 'bad' : 'good';
      parts.push('<div class="ds-block">');
      parts.push('<strong>Availability &amp; Pricing:</strong> ');
      parts.push('<span class="' + cls + '">' + escapeHtml(av.source || 'Unknown') + '</span>');
      if (av.endpoint) parts.push('<br>Endpoint: <code>' + escapeHtml(av.endpoint) + '</code>');
      if (av.env) parts.push('<br>GoDaddy Environment: <strong>' + escapeHtml(av.env) + '</strong>');
      if (av.credentialsSource) parts.push('<br>Credentials from: <strong>' + escapeHtml(av.credentialsSource) + '</strong>');
      parts.push('<br>API Key present: <strong>' + (av.apiKeyPresent ? 'YES' : 'NO') + '</strong>');
      if (av.status) parts.push('<br>GoDaddy response status: <strong>' + escapeHtml(String(av.status)) + '</strong>');
      if (av.resultCount != null) parts.push('<br>Results returned: <strong>' + av.resultCount + '</strong>');
      parts.push('<br>Synthetic data: <strong class="' + (av.syntheticData ? 'bad' : 'good') + '">' + (av.syntheticData ? 'YES' : 'NO') + '</strong>');
      parts.push('</div>');
    }

    if (dataSourceState.godaddyDebug && dataSourceState.godaddyDebug.sampleRawResponse) {
      parts.push('<div class="ds-block">');
      parts.push('<strong>Sample GoDaddy Raw Response:</strong><br>');
      parts.push('<pre style="font-size:0.75rem;overflow-x:auto;max-width:100%;">' + escapeHtml(JSON.stringify(dataSourceState.godaddyDebug.sampleRawResponse, null, 2)) + '</pre>');
      parts.push('</div>');
    }

    if (dataSourceState.syntheticFlags.length > 0) {
      parts.push('<div class="ds-block warn-block">');
      parts.push('<strong>Synthetic/Simulated Data Warnings:</strong><ul>');
      dataSourceState.syntheticFlags.forEach(function (f) {
        parts.push('<li>' + escapeHtml(f) + '</li>');
      });
      parts.push('</ul></div>');
    }

    el.innerHTML = parts.join('');
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
            <th>Name Source</th>
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
                <td>${escapeHtml(row.nameSource || '-')}</td>
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
    dataSourceState.nameGeneration = null;
    dataSourceState.availability = null;
    dataSourceState.godaddyDebug = null;
    dataSourceState.syntheticFlags = [];
    var dsPanel = document.getElementById('data-source-panel');
    if (dsPanel) { dsPanel.hidden = true; dsPanel.innerHTML = ''; }

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
      // #region agent log
      if (message.payload.sessionId === 'efbcb6') {
        fetch('http://127.0.0.1:7244/ingest/0500be7a-802e-498d-b34c-96092e89bf3b', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'efbcb6' }, body: JSON.stringify(message.payload) }).catch(function () {});
      }
      // #endregion
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

})();
