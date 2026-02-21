(function () {
  const WORKER_VERSION = '2026-02-20-threshold-adherence-v1';

  const els = {
    startBtn: document.getElementById('start-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
    copyBtn: document.getElementById('copy-btn'),
    copyTableBtn: document.getElementById('copy-table-btn'),
    downloadBtn: document.getElementById('download-btn'),
    statusLabel: document.getElementById('status-label'),
    statusDetail: document.getElementById('status-detail'),
    progressFill: document.getElementById('progress-fill'),
    errorBox: document.getElementById('error-box'),
    jsonPanel: document.getElementById('json-panel'),
    jsonOutput: document.getElementById('json-output'),
    summaryGrid: document.getElementById('summary-grid'),
    requestedAssets: document.getElementById('requested-assets'),
    analyzedAssets: document.getElementById('analyzed-assets'),
    skippedAssets: document.getElementById('skipped-assets'),
    generatedAt: document.getElementById('generated-at'),
    visualsCard: document.getElementById('visuals-card'),
    resultsTableBody: document.getElementById('results-table-body'),
    chartsCard: document.getElementById('charts-card'),
    coinCharts: document.getElementById('coin-charts'),
    minDrawdownPct: document.getElementById('min-drawdown-pct'),
    minAthToTroughDays: document.getElementById('min-ath-to-trough-days'),
  };

  let worker = null;
  let isRunning = false;
  let currentResult = null;
  let currentTableRows = [];

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(`worker.js?v=${encodeURIComponent(WORKER_VERSION)}`);
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', onWorkerError);
    return worker;
  }

  function onWorkerMessage(event) {
    const msg = event.data || {};
    if (msg.type === 'PROGRESS') {
      setError('');
      setStatus('Running', msg.message || 'Processing...');
      setProgress(msg.progress);
      return;
    }

    if (msg.type === 'COMPLETE') {
      isRunning = false;
      setProgress(1);
      setStatus('Done', 'Analysis complete.');
      currentResult = msg.result || null;
      const pretty = JSON.stringify(currentResult, null, 2);
      els.jsonOutput.textContent = pretty;
      if (els.jsonPanel) els.jsonPanel.open = false;
      setSummary(currentResult);
      try {
        const rowCount = renderVisuals(currentResult);
        if (els.copyTableBtn) els.copyTableBtn.disabled = rowCount < 1;
      } catch (error) {
        setError(`Visualization rendering failed: ${error && error.message ? error.message : 'Unknown error'}`);
        if (els.copyTableBtn) els.copyTableBtn.disabled = true;
      }
      els.copyBtn.disabled = false;
      els.downloadBtn.disabled = false;
      els.startBtn.disabled = false;
      els.cancelBtn.disabled = true;
      return;
    }

    if (msg.type === 'ERROR') {
      isRunning = false;
      if (msg.code === 'analysis_canceled') {
        setStatus('Canceled', msg.message || 'Analysis canceled.');
        setError('');
      } else {
        setStatus('Failed', 'Analysis failed.');
        setError(msg.message || 'Unknown worker error.');
      }
      els.startBtn.disabled = false;
      els.cancelBtn.disabled = true;
      return;
    }
  }

  function onWorkerError(event) {
    isRunning = false;
    setStatus('Failed', 'Worker runtime error.');
    setError(event && event.message ? event.message : 'Unknown worker runtime error.');
    els.startBtn.disabled = false;
    els.cancelBtn.disabled = true;
  }

  function setProgress(progress) {
    const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const pct = Math.round(clamped * 100);
    els.progressFill.style.width = `${pct}%`;
    const track = els.progressFill.parentElement;
    if (track) track.setAttribute('aria-valuenow', String(pct));
  }

  function setStatus(label, detail) {
    els.statusLabel.textContent = label;
    els.statusDetail.textContent = detail;
  }

  function setError(message) {
    if (!message) {
      els.errorBox.hidden = true;
      els.errorBox.textContent = '';
      return;
    }
    els.errorBox.hidden = false;
    els.errorBox.textContent = message;
  }

  function setSummary(result) {
    const counts = result && result.results && result.results.counts ? result.results.counts : null;
    els.requestedAssets.textContent = counts ? String(counts.requested_assets) : '-';
    els.analyzedAssets.textContent = counts ? String(counts.analyzed_assets) : '-';
    els.skippedAssets.textContent = counts ? String(counts.skipped_assets) : '-';
    els.generatedAt.textContent = result && result.generated_at_utc ? String(result.generated_at_utc) : '-';
    els.summaryGrid.hidden = false;
  }

  function timestampForFilename(date) {
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  }

  function startRun() {
    if (isRunning) return;
    ensureWorker();
    isRunning = true;
    currentResult = null;
    els.startBtn.disabled = true;
    els.cancelBtn.disabled = false;
    els.copyBtn.disabled = true;
    if (els.copyTableBtn) els.copyTableBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.summaryGrid.hidden = true;
    clearVisuals();
    els.jsonOutput.textContent = 'Running analysis...';
    setError('');
    setStatus('Running', 'Initializing data sources...');
    setProgress(0.02);
    const config = readRunConfig();
    worker.postMessage({
      type: 'START_ANALYSIS',
      config: config,
    });
  }

  function cancelRun() {
    if (!isRunning || !worker) return;
    worker.postMessage({ type: 'CANCEL_ANALYSIS' });
    setStatus('Canceling', 'Stopping analysis...');
  }

  async function copyJson() {
    if (!currentResult) return;
    await copyText(JSON.stringify(currentResult, null, 2), 'JSON copied to clipboard.');
  }

  async function copyTable() {
    if (!currentTableRows.length) return;
    const text = buildTableTsv(currentTableRows);
    await copyText(text, 'Table copied to clipboard (TSV).');
  }

  async function copyText(text, successMessage) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        legacyCopyText(text);
      }
      setError('');
      setStatus('Done', successMessage);
    } catch (_) {
      setError('Clipboard copy failed. Your browser may block clipboard access.');
    }
  }

  function legacyCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  }

  function buildTableTsv(rows) {
    const headers = [
      'Rank',
      'Coin',
      'Cycle',
      'ATH Date',
      'ATH High',
      'Trough Date',
      'Trough Close',
      'Drawdown %',
      'Days ATH to Trough',
      'Next ATH Date',
      'Next ATH High',
      'Recovery Gain %',
      'Completed'
    ];
    const lines = [headers.join('\t')];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const values = [
        valueOrDash(row.rank),
        valueOrDash(row.coin),
        valueOrDash(row.cycleIndex),
        valueOrDash(row.athDate),
        formatPrice(row.athHigh),
        valueOrDash(row.troughDate),
        formatPrice(row.troughClose),
        formatPercent(row.drawdownPct),
        valueOrDash(row.daysAthToTrough),
        valueOrDash(row.nextAthDate),
        formatPrice(row.nextAthHigh),
        formatPercent(row.recoveryPct),
        valueOrDash(row.completed)
      ].map(stripTabsAndNewlines);
      lines.push(values.join('\t'));
    }
    return lines.join('\n');
  }

  function stripTabsAndNewlines(value) {
    return String(value).replace(/[\t\r\n]+/g, ' ').trim();
  }

  function downloadJson() {
    if (!currentResult) return;
    const text = JSON.stringify(currentResult, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crypto_peak_finder_${timestampForFilename(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function clearVisuals() {
    currentTableRows = [];
    if (els.resultsTableBody) els.resultsTableBody.innerHTML = '';
    if (els.coinCharts) els.coinCharts.innerHTML = '';
    if (els.visualsCard) els.visualsCard.hidden = true;
    if (els.chartsCard) els.chartsCard.hidden = true;
  }

  function cyclesMeetingThreshold(cycles, thresholding) {
    if (!Array.isArray(cycles) || !cycles.length) return [];
    const minPct = Number(thresholding && thresholding.major_cycle_min_range_pct);
    const minDays = Number(thresholding && thresholding.major_cycle_min_ath_to_trough_days);
    const hasPct = Number.isFinite(minPct) && minPct >= 0;
    const hasDays = Number.isFinite(minDays) && minDays >= 0;
    if (!hasPct && !hasDays) return cycles;
    return cycles.filter(function (c) {
      const drawdownAbs = Math.abs(Number(c.drawdown_pct));
      const days = Number(c.days_ath_to_trough);
      if (hasPct && drawdownAbs < minPct) return false;
      if (hasDays && days < minDays) return false;
      return true;
    });
  }

  function renderVisuals(result) {
    clearVisuals();
    const analyzed = result && result.results && Array.isArray(result.results.analyzed_assets)
      ? result.results.analyzed_assets
      : [];
    const thresholding = result && result.methodology && result.methodology.major_cycle_thresholding ? result.methodology.major_cycle_thresholding : null;
    const rowCount = renderCycleTable(analyzed, result, thresholding);
    renderCoinCharts(analyzed, thresholding);
    return rowCount;
  }

  function renderCycleTable(analyzedAssets, result, thresholding) {
    const rows = [];
    for (let i = 0; i < analyzedAssets.length; i += 1) {
      const entry = analyzedAssets[i] || {};
      const asset = entry.asset || {};
      const rawCycles = Array.isArray(entry.cycles) ? entry.cycles : [];
      const cycles = cyclesMeetingThreshold(rawCycles, thresholding);
      for (let j = 0; j < cycles.length; j += 1) {
        const cycle = cycles[j] || {};
        rows.push({
          rank: asset.market_cap_rank,
          coin: `${asset.name || '-'} (${asset.symbol || '-'})`,
          cycleIndex: cycle.cycle_index,
          athDate: cycle.ath_date_utc,
          athHigh: cycle.ath_price_high,
          troughDate: cycle.trough_date_utc,
          troughClose: cycle.trough_price_close,
          drawdownPct: cycle.drawdown_pct,
          daysAthToTrough: cycle.days_ath_to_trough,
          nextAthDate: cycle.next_ath_date_utc,
          nextAthHigh: cycle.next_ath_price_high,
          recoveryPct: cycle.trough_to_next_ath_gain_pct,
          completed: cycle.is_completed_cycle === true ? 'Yes' : 'No',
        });
      }
    }

    rows.sort(function (a, b) {
      const rankA = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
      const rankB = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      const cycleA = Number.isFinite(a.cycleIndex) ? a.cycleIndex : Number.MAX_SAFE_INTEGER;
      const cycleB = Number.isFinite(b.cycleIndex) ? b.cycleIndex : Number.MAX_SAFE_INTEGER;
      return cycleA - cycleB;
    });

    if (!rows.length) {
      const noData = `<tr><td colspan="13">No retained major cycles found in analyzed assets for this run.</td></tr>`;
      els.resultsTableBody.innerHTML = noData;
      els.visualsCard.hidden = false;
      currentTableRows = [];
      return 0;
    }
    const html = rows.map(function (row) {
      return `<tr>
        <td>${escapeHtml(valueOrDash(row.rank))}</td>
        <td>${escapeHtml(valueOrDash(row.coin))}</td>
        <td>${escapeHtml(valueOrDash(row.cycleIndex))}</td>
        <td>${escapeHtml(valueOrDash(row.athDate))}</td>
        <td>${escapeHtml(formatPrice(row.athHigh))}</td>
        <td>${escapeHtml(valueOrDash(row.troughDate))}</td>
        <td>${escapeHtml(formatPrice(row.troughClose))}</td>
        <td>${escapeHtml(formatPercent(row.drawdownPct))}</td>
        <td>${escapeHtml(valueOrDash(row.daysAthToTrough))}</td>
        <td>${escapeHtml(valueOrDash(row.nextAthDate))}</td>
        <td>${escapeHtml(formatPrice(row.nextAthHigh))}</td>
        <td>${escapeHtml(formatPercent(row.recoveryPct))}</td>
        <td>${escapeHtml(row.completed)}</td>
      </tr>`;
    }).join('');
    els.resultsTableBody.innerHTML = html;
    els.visualsCard.hidden = false;
    currentTableRows = rows;
    return rows.length;
  }

  function renderCoinCharts(analyzedAssets, thresholding) {
    if (!analyzedAssets.length) {
      const msg = document.createElement('p');
      msg.className = 'coin-chart-empty';
      msg.textContent = 'No analyzed assets were returned for this run.';
      els.coinCharts.appendChild(msg);
      els.chartsCard.hidden = false;
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < analyzedAssets.length; i += 1) {
      const entry = analyzedAssets[i] || {};
      const asset = entry.asset || {};
      const rawCycles = Array.isArray(entry.cycles) ? entry.cycles : [];
      const cycles = cyclesMeetingThreshold(rawCycles, thresholding);
      const card = document.createElement('article');
      card.className = 'coin-chart-card';

      const title = document.createElement('h3');
      title.textContent = `${asset.name || '-'} (${asset.symbol || '-'})`;
      card.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'coin-chart-meta';
      const completedCount = cycles.filter(function (c) { return c && c.is_completed_cycle === true; }).length;
      meta.textContent = `Rank ${valueOrDash(asset.market_cap_rank)} | Binance ${valueOrDash(asset.binance_symbol)} | Cycles ${cycles.length} (${completedCount} completed)`;
      card.appendChild(meta);

      if (!cycles.length) {
        const empty = document.createElement('p');
        empty.className = 'coin-chart-empty';
        empty.textContent = 'No retained major cycles for this coin.';
        card.appendChild(empty);
        frag.appendChild(card);
        continue;
      }

      const host = document.createElement('div');
      host.className = 'coin-chart-svg';
      card.appendChild(host);
      renderCoinChartWithD3(host, cycles);
      frag.appendChild(card);
    }
    els.coinCharts.appendChild(frag);
    els.chartsCard.hidden = false;
  }

  function renderCoinChartWithD3(container, cycles) {
    if (!window.d3) {
      const msg = document.createElement('p');
      msg.className = 'coin-chart-empty';
      msg.textContent = 'D3 did not load.';
      container.appendChild(msg);
      return;
    }
    const points = collectChartPoints(cycles);
    if (!points.length) {
      container.textContent = 'No usable ATH/trough points in retained cycles.';
      return;
    }

    const d3 = window.d3;
    const width = 920;
    const height = 240;
    const margin = { top: 14, right: 12, bottom: 28, left: 58 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'none');

    const x = d3.scaleTime()
      .domain(d3.extent(points, function (d) { return new Date(d.time); }))
      .range([margin.left, margin.left + innerW]);

    const yMin = d3.min(points, function (d) { return d.price; });
    const yMax = d3.max(points, function (d) { return d.price; });
    const yPad = (yMax - yMin || yMax * 0.1 || 1) * 0.08;
    const y = d3.scaleLinear()
      .domain([Math.max(0, yMin - yPad), yMax + yPad])
      .nice()
      .range([margin.top + innerH, margin.top]);

    const xAxis = d3.axisBottom(x).ticks(4).tickFormat(d3.timeFormat('%Y-%m-%d'));
    const yAxis = d3.axisLeft(y).ticks(4).tickFormat(function (v) { return formatPrice(v); });

    svg.append('g')
      .attr('transform', `translate(0,${margin.top + innerH})`)
      .attr('class', 'coin-axis')
      .call(xAxis);

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('class', 'coin-axis')
      .call(yAxis);

    svg.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('class', 'coin-line')
      .attr('d', d3.line()
        .x(function (d) { return x(new Date(d.time)); })
        .y(function (d) { return y(d.price); }));

    svg.selectAll('.coin-point')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', function (d) { return d.kind === 'ath' ? 'coin-point-ath' : 'coin-point-trough'; })
      .attr('r', function (d) { return d.kind === 'ath' ? 3.8 : 3.4; })
      .attr('cx', function (d) { return x(new Date(d.time)); })
      .attr('cy', function (d) { return y(d.price); })
      .append('title')
      .text(function (d) { return `${d.kind.toUpperCase()} | ${d.date} | ${formatPrice(d.price)}`; });
  }

  function collectChartPoints(cycles) {
    const events = [];
    for (let i = 0; i < cycles.length; i += 1) {
      const c = cycles[i] || {};
      pushChartEvent(events, c.ath_date_utc, c.ath_price_high, 'ath');
      pushChartEvent(events, c.trough_date_utc, c.trough_price_close, 'trough');
      pushChartEvent(events, c.next_ath_date_utc, c.next_ath_price_high, 'ath');
    }

    events.sort(function (a, b) {
      if (a.time !== b.time) return a.time - b.time;
      if (a.kind === b.kind) return 0;
      return a.kind === 'ath' ? -1 : 1;
    });

    const seen = new Set();
    const points = [];
    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i];
      const key = `${ev.time}|${ev.kind}|${ev.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(ev);
    }
    return points;
  }

  function pushChartEvent(events, dateText, priceValue, kind) {
    const t = Date.parse(String(dateText || ''));
    const p = Number(priceValue);
    if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) return;
    events.push({
      time: t,
      date: String(dateText),
      price: p,
      kind: kind === 'trough' ? 'trough' : 'ath',
    });
  }

  function readRunConfig() {
    const minDrawdownPct = clampInteger(els.minDrawdownPct ? els.minDrawdownPct.value : 60, 1, 99, 60);
    const minAthToTroughDays = clampInteger(els.minAthToTroughDays ? els.minAthToTroughDays.value : 60, 1, 2000, 60);
    if (els.minDrawdownPct) els.minDrawdownPct.value = String(minDrawdownPct);
    if (els.minAthToTroughDays) els.minAthToTroughDays.value = String(minAthToTroughDays);
    return {
      major_cycle_min_range_pct: minDrawdownPct,
      major_cycle_min_ath_to_trough_days: minAthToTroughDays,
    };
  }

  function clampInteger(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function valueOrDash(value) {
    return value === null || value === undefined || value === '' ? '-' : String(value);
  }

  function formatPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString(undefined, {
      minimumFractionDigits: n >= 100 ? 2 : 4,
      maximumFractionDigits: n >= 100 ? 2 : 6,
    });
  }

  function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n.toFixed(2)}%`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  els.startBtn.addEventListener('click', startRun);
  els.cancelBtn.addEventListener('click', cancelRun);
  els.copyBtn.addEventListener('click', copyJson);
  if (els.copyTableBtn) els.copyTableBtn.addEventListener('click', copyTable);
  els.downloadBtn.addEventListener('click', downloadJson);
})();
