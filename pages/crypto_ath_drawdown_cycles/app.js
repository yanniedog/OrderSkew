(function () {
  const els = {
    startBtn: document.getElementById('start-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
    copyBtn: document.getElementById('copy-btn'),
    downloadBtn: document.getElementById('download-btn'),
    statusLabel: document.getElementById('status-label'),
    statusDetail: document.getElementById('status-detail'),
    progressFill: document.getElementById('progress-fill'),
    errorBox: document.getElementById('error-box'),
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
  };

  let worker = null;
  let isRunning = false;
  let currentResult = null;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('worker.js');
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
      setSummary(currentResult);
      try {
        renderVisuals(currentResult);
      } catch (error) {
        setError(`Visualization rendering failed: ${error && error.message ? error.message : 'Unknown error'}`);
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
    els.downloadBtn.disabled = true;
    els.summaryGrid.hidden = true;
    clearVisuals();
    els.jsonOutput.textContent = 'Running analysis...';
    setError('');
    setStatus('Running', 'Initializing data sources...');
    setProgress(0.02);
    worker.postMessage({ type: 'START_ANALYSIS' });
  }

  function cancelRun() {
    if (!isRunning || !worker) return;
    worker.postMessage({ type: 'CANCEL_ANALYSIS' });
    setStatus('Canceling', 'Stopping analysis...');
  }

  async function copyJson() {
    if (!currentResult) return;
    const text = JSON.stringify(currentResult, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Done', 'JSON copied to clipboard.');
    } catch (_) {
      setError('Clipboard copy failed. Your browser may block clipboard access.');
    }
  }

  function downloadJson() {
    if (!currentResult) return;
    const text = JSON.stringify(currentResult, null, 2);
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `top20_exstable_ath_drawdown_cycles_${timestampForFilename(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function clearVisuals() {
    if (els.resultsTableBody) els.resultsTableBody.innerHTML = '';
    if (els.coinCharts) els.coinCharts.innerHTML = '';
    if (els.visualsCard) els.visualsCard.hidden = true;
    if (els.chartsCard) els.chartsCard.hidden = true;
  }

  function renderVisuals(result) {
    clearVisuals();
    const analyzed = result && result.results && Array.isArray(result.results.analyzed_assets)
      ? result.results.analyzed_assets
      : [];
    renderCycleTable(analyzed);
    renderCoinCharts(analyzed);
  }

  function renderCycleTable(analyzedAssets) {
    const rows = [];
    for (let i = 0; i < analyzedAssets.length; i += 1) {
      const entry = analyzedAssets[i] || {};
      const asset = entry.asset || {};
      const cycles = Array.isArray(entry.cycles) ? entry.cycles : [];
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
      return;
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
  }

  function renderCoinCharts(analyzedAssets) {
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
      const cycles = Array.isArray(entry.cycles) ? entry.cycles : [];
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

      const svg = buildAthTroughChartSvg(cycles);
      card.appendChild(svg);
      frag.appendChild(card);
    }
    els.coinCharts.appendChild(frag);
    els.chartsCard.hidden = false;
  }

  function buildAthTroughChartSvg(cycles) {
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

    if (!points.length) {
      const emptySvg = createSvgEl('svg');
      emptySvg.setAttribute('class', 'coin-chart-svg');
      emptySvg.setAttribute('viewBox', '0 0 920 260');
      emptySvg.setAttribute('preserveAspectRatio', 'none');
      const label = createSvgEl('text');
      label.setAttribute('x', '460');
      label.setAttribute('y', '132');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'coin-axis-label');
      label.textContent = 'No usable ATH/trough points in retained cycles.';
      emptySvg.appendChild(label);
      return emptySvg;
    }

    const width = 920;
    const height = 260;
    const pad = { top: 16, right: 16, bottom: 30, left: 58 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const minTime = points[0].time;
    const maxTime = points.length > 1 ? points[points.length - 1].time : minTime + 86400000;
    let minPrice = Math.min.apply(null, points.map(function (p) { return p.price; }));
    let maxPrice = Math.max.apply(null, points.map(function (p) { return p.price; }));
    if (minPrice === maxPrice) {
      minPrice *= 0.95;
      maxPrice *= 1.05;
    }
    const pricePad = (maxPrice - minPrice) * 0.08;
    minPrice -= pricePad;
    maxPrice += pricePad;

    const x = function (t) {
      return pad.left + ((t - minTime) / (maxTime - minTime)) * innerW;
    };
    const y = function (p) {
      return pad.top + (1 - ((p - minPrice) / (maxPrice - minPrice))) * innerH;
    };

    const svg = createSvgEl('svg');
    svg.setAttribute('class', 'coin-chart-svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    for (let i = 0; i < 4; i += 1) {
      const yy = pad.top + (i / 3) * innerH;
      const grid = createSvgEl('line');
      grid.setAttribute('x1', String(pad.left));
      grid.setAttribute('x2', String(width - pad.right));
      grid.setAttribute('y1', String(yy));
      grid.setAttribute('y2', String(yy));
      grid.setAttribute('class', 'coin-grid-line');
      svg.appendChild(grid);
    }

    let d = '';
    for (let i = 0; i < points.length; i += 1) {
      const px = x(points[i].time);
      const py = y(points[i].price);
      d += `${i === 0 ? 'M' : 'L'}${px.toFixed(2)},${py.toFixed(2)} `;
    }
    const path = createSvgEl('path');
    path.setAttribute('d', d.trim());
    path.setAttribute('class', 'coin-line');
    svg.appendChild(path);

    for (let i = 0; i < points.length; i += 1) {
      const pt = points[i];
      const cx = x(pt.time);
      const cy = y(pt.price);
      const marker = createSvgEl('circle');
      marker.setAttribute('cx', String(cx));
      marker.setAttribute('cy', String(cy));
      marker.setAttribute('r', pt.kind === 'ath' ? '4' : '3.6');
      marker.setAttribute('class', pt.kind === 'ath' ? 'coin-point-ath' : 'coin-point-trough');
      const title = createSvgEl('title');
      title.textContent = `${pt.kind.toUpperCase()} | ${pt.date} | ${formatPrice(pt.price)}`;
      marker.appendChild(title);
      svg.appendChild(marker);
    }

    const yMax = createSvgEl('text');
    yMax.setAttribute('x', '6');
    yMax.setAttribute('y', String(pad.top + 5));
    yMax.setAttribute('class', 'coin-axis-label');
    yMax.textContent = formatPrice(maxPrice);
    svg.appendChild(yMax);

    const yMin = createSvgEl('text');
    yMin.setAttribute('x', '6');
    yMin.setAttribute('y', String(height - pad.bottom));
    yMin.setAttribute('class', 'coin-axis-label');
    yMin.textContent = formatPrice(minPrice);
    svg.appendChild(yMin);

    const leftDate = createSvgEl('text');
    leftDate.setAttribute('x', String(pad.left));
    leftDate.setAttribute('y', String(height - 8));
    leftDate.setAttribute('class', 'coin-axis-label');
    leftDate.textContent = points[0].date;
    svg.appendChild(leftDate);

    const rightDate = createSvgEl('text');
    rightDate.setAttribute('x', String(width - pad.right));
    rightDate.setAttribute('y', String(height - 8));
    rightDate.setAttribute('text-anchor', 'end');
    rightDate.setAttribute('class', 'coin-axis-label');
    rightDate.textContent = points[points.length - 1].date;
    svg.appendChild(rightDate);

    return svg;
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

  function createSvgEl(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
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
  els.downloadBtn.addEventListener('click', downloadJson);
})();
