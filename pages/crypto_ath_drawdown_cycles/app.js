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
    repoCommitStamp: document.getElementById('repo-commit-stamp'),
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

  function formatUtcStamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }

  async function loadLatestCommitStamp() {
    if (!els.repoCommitStamp) return;
    try {
      const response = await fetch('https://api.github.com/repos/yanniedog/orderskew/commits/main', {
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        els.repoCommitStamp.textContent = `Latest GitHub commit (main): unavailable (${response.status})`;
        return;
      }
      const payload = await response.json();
      const sha = payload && payload.sha ? String(payload.sha).slice(0, 7) : 'unknown';
      const dateIso = payload && payload.commit && payload.commit.committer ? payload.commit.committer.date : null;
      const formatted = dateIso ? formatUtcStamp(dateIso) : null;
      els.repoCommitStamp.textContent = formatted
        ? `Latest GitHub commit (main): ${formatted} • ${sha}`
        : `Latest GitHub commit (main): unknown date • ${sha}`;
    } catch (_) {
      els.repoCommitStamp.textContent = 'Latest GitHub commit (main): unavailable (network error)';
    }
  }

  els.startBtn.addEventListener('click', startRun);
  els.cancelBtn.addEventListener('click', cancelRun);
  els.copyBtn.addEventListener('click', copyJson);
  els.downloadBtn.addEventListener('click', downloadJson);
  loadLatestCommitStamp();
})();
