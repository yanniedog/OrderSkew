(function () {
  let worker = null;
  try {
    worker = new Worker('engine.worker.js');
  } catch (error) {
    const fallback = document.getElementById('form-error');
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = `Failed to start browser worker: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
    return;
  }

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
    if (status === 'running' && phase === 'godaddy') return 'Availability + pricing heuristic';
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
        return `
          <tr>
            <td>${escapeHtml(row.domain)}</td>
            ${availabilityCell(row)}
            <td>${formatMoney(row.price, row.currency)}</td>
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

    const sortedRanked = sortRows(results.allRanked || [], currentSortMode);
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
    };
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
    } else {
      showJobError('');
    }

    if (job.results) {
      currentResults = job.results;
      renderResults(currentResults);
      downloadJsonBtn.disabled = false;
    }

    if (job.status === 'done' || job.status === 'failed') {
      startBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  }

  function downloadResultsJson() {
    if (!currentResults || !currentJob) {
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      run: currentJob,
      results: currentResults,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `domainname_wizard_${currentJob.id || 'run'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleStart() {
    showFormError('');
    showJobError('');

    const input = collectInput();
    if (!input.keywords || input.keywords.length < 2) {
      showFormError('Keywords must be at least 2 characters.');
      return;
    }

    resultsPanelEl.hidden = true;
    currentResults = null;
    downloadJsonBtn.disabled = true;

    worker.postMessage({ type: 'start', input: input });
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    statusLabelEl.textContent = 'Queued';
    progressLabelEl.textContent = '(0%)';
    loopLabelEl.textContent = 'Loop -/-';
    elapsedLabelEl.textContent = 'Elapsed: 00:00';
    progressFillEl.style.width = '0%';
  }

  worker.addEventListener('message', function (event) {
    const message = event.data || {};

    if (message.type === 'state' && message.job) {
      updateStatus(message.job);
      return;
    }

    if (message.type === 'error') {
      const details = message.message || 'Unknown worker error.';
      showFormError(details);
      startBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  });

  worker.addEventListener('error', function (event) {
    showFormError(event.message || 'Worker runtime error.');
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
    worker.postMessage({ type: 'cancel', jobId: currentJob.id });
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
})();
