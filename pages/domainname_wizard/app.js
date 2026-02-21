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
  const domainFilterIncludeEl = document.getElementById('domain-filter-include');
  const domainFilterExcludeEl = document.getElementById('domain-filter-exclude');
  const clearDomainFiltersBtn = document.getElementById('clear-domain-filters-btn');
  const domainFilterStatusEl = document.getElementById('domain-filter-status');
  const summaryKpisEl = document.getElementById('summary-kpis');
  const allRankedTableEl = document.getElementById('all-ranked-table');
  const withinBudgetTableEl = document.getElementById('within-budget-table');
  const unavailableTableEl = document.getElementById('unavailable-table');
  const loopSummaryTableEl = document.getElementById('loop-summary-table');
  const tuningTableEl = document.getElementById('tuning-table');
  const keywordLibraryTableEl = document.getElementById('keyword-library-table');
  const rewardPresetEl = document.getElementById('reward-preset');
  const rewardSliderEls = {
    realWordParts: document.getElementById('reward-realwordparts'),
    cpcKeywords: document.getElementById('reward-cpc'),
    cvFlow: document.getElementById('reward-cvflow'),
    keywordMatch: document.getElementById('reward-keywordmatch'),
    brandability: document.getElementById('reward-brandability'),
    memorability: document.getElementById('reward-memorability'),
    devSignal: document.getElementById('reward-devsignal'),
  };
  const REWARD_PRESETS = {
    balanced: { realWordParts: 1.0, cpcKeywords: 1.0, cvFlow: 1.0, keywordMatch: 1.0, brandability: 1.0, memorability: 1.0, devSignal: 1.0 },
    brandability: { realWordParts: 1.2, cpcKeywords: 0.6, cvFlow: 1.4, keywordMatch: 1.0, brandability: 1.8, memorability: 1.5, devSignal: 0.7 },
    commercial: { realWordParts: 1.1, cpcKeywords: 2.0, cvFlow: 0.9, keywordMatch: 1.6, brandability: 0.9, memorability: 0.8, devSignal: 0.9 },
    devsignal: { realWordParts: 0.9, cpcKeywords: 0.9, cvFlow: 1.0, keywordMatch: 1.2, brandability: 1.0, memorability: 0.9, devSignal: 2.2 },
  };

  let currentJob = null;
  let currentResults = null;
  let currentInput = null;
  let currentSortMode = 'valueRatio';
  const debugLogs = [];
  let lastLoggedJobErrorKey = '';
  let lastLoggedJobStateKey = '';
  let latestRunExport = null;
  let renderResultsTimeoutId = null;
  let lastRenderedResultsVersion = -1;
  const COLUMN_PREFS_KEY = 'domainname_wizard.table_columns.v1';
  const TABLE_PAGE_SIZE = 200;
  const tablePageState = {};
  const SECTION_COLUMN_OPTIONS = {
    'all-ranked-table': ['domain', 'availability', 'price', 'estimatedValue', 'valueRatio', 'valueMetrics', 'finance', 'quality', 'signals', 'words', 'notes', 'realWordPartsScore', 'cpcKeywordScore', 'bestCpcTier', 'bestCpcWord', 'cvFlowScore', 'keywordMatchScore', 'devSignalScore', 'notesPriorityScore'],
    'within-budget-table': ['domain', 'availability', 'price', 'estimatedValue', 'valueRatio', 'valueMetrics', 'finance', 'quality', 'signals', 'words', 'notes', 'realWordPartsScore', 'cpcKeywordScore', 'bestCpcTier', 'bestCpcWord', 'cvFlowScore', 'keywordMatchScore', 'devSignalScore', 'notesPriorityScore'],
    'unavailable-table': ['domain', 'availability', 'price', 'estimatedValue', 'valueRatio', 'valueMetrics', 'finance', 'quality', 'signals', 'words', 'notes', 'realWordPartsScore', 'cpcKeywordScore', 'bestCpcTier', 'bestCpcWord', 'cvFlowScore', 'keywordMatchScore', 'devSignalScore', 'notesPriorityScore'],
    'loop-summary-table': ['loop', 'keywords', 'strategy', 'explore', 'quota', 'results', 'top', 'sourceNote'],
    'tuning-table': ['loop', 'keywords', 'strategy', 'explore', 'repetitionPenalty', 'reward', 'featureWeights'],
    'keyword-library-table': ['rank', 'word', 'state', 'usage', 'evidence', 'lastLoop'],
  };
  const DEFAULT_SECTION_COLUMNS = {
    'all-ranked-table': ['domain', 'price', 'estimatedValue', 'valueRatio', 'valueMetrics', 'finance', 'quality', 'signals', 'words', 'notes'],
    'within-budget-table': ['domain', 'price', 'estimatedValue', 'valueRatio', 'valueMetrics', 'finance', 'quality', 'signals', 'words', 'notes'],
    'unavailable-table': ['domain', 'availability', 'price', 'estimatedValue', 'valueRatio', 'valueMetrics', 'finance', 'quality', 'signals', 'words', 'notes'],
    'loop-summary-table': ['loop', 'keywords', 'strategy', 'explore', 'quota', 'results', 'top', 'sourceNote'],
    'tuning-table': ['loop', 'keywords', 'strategy', 'explore', 'repetitionPenalty', 'reward'],
    'keyword-library-table': ['rank', 'word', 'state', 'usage', 'evidence', 'lastLoop'],
  };
  let sectionColumnState = {};
  const DEBUG_LOGS_MAX_DEFAULT = 500;
  const DEBUG_LOGS_MAX_LOW_MEMORY = 200;
  let currentDebugLogsMax = DEBUG_LOGS_MAX_DEFAULT;
  const ENGINE_WORKER_VERSION = '2026-02-20-1';
  const tableSortState = new WeakMap();
  let dataSourceCollapsed = true;
  let diagnosticsInFlight = null;
  let persistentRewardPolicy = null;
  let persistentRewardPolicyMeta = null;
  let persistedRunIds = new Set();
  const SESSION_KEYWORDS_KEY = 'domainname_wizard.default_keywords.v1';
  const SESSION_DEFAULT_KEYWORDS = [
    'agentic workflow automation',
    'edge ai monitoring',
    'developer productivity copilot',
    'compliance ops platform',
    'supply chain intelligence',
    'finops optimization engine',
    'cyber risk analytics',
    'revenue intelligence studio',
    'clinical data platform',
    'customer support orchestration',
    'marketplace fraud detection',
    'pricing optimization lab',
  ];

  function setSessionDefaultKeywords() {
    if (!formEl) return;
    const keywordsInput = formEl.querySelector('input[name="keywords"]');
    if (!keywordsInput) return;

    const current = String(keywordsInput.value || '').trim();
    if (current && current.toLowerCase() !== 'ai productivity') return;

    let chosen = '';
    try {
      chosen = String(sessionStorage.getItem(SESSION_KEYWORDS_KEY) || '').trim();
    } catch (_) {}
    if (!chosen) {
      chosen = SESSION_DEFAULT_KEYWORDS[Math.floor(Math.random() * SESSION_DEFAULT_KEYWORDS.length)] || 'startup platform';
      try { sessionStorage.setItem(SESSION_KEYWORDS_KEY, chosen); } catch (_) {}
    }
    keywordsInput.value = chosen;
  }

  function updateRewardValueBadges() {
    Object.values(rewardSliderEls).forEach(function (el) {
      if (!el) return;
      const badge = document.querySelector(`[data-reward-value-for="${el.id}"]`);
      if (badge) badge.textContent = Number(el.value || 0).toFixed(1);
    });
  }

  function getRewardFeatureWeights() {
    return {
      realWordParts: parseNumber(rewardSliderEls.realWordParts && rewardSliderEls.realWordParts.value, 1),
      cpcKeywords: parseNumber(rewardSliderEls.cpcKeywords && rewardSliderEls.cpcKeywords.value, 1),
      cvFlow: parseNumber(rewardSliderEls.cvFlow && rewardSliderEls.cvFlow.value, 1),
      keywordMatch: parseNumber(rewardSliderEls.keywordMatch && rewardSliderEls.keywordMatch.value, 1),
      brandability: parseNumber(rewardSliderEls.brandability && rewardSliderEls.brandability.value, 1),
      memorability: parseNumber(rewardSliderEls.memorability && rewardSliderEls.memorability.value, 1),
      devSignal: parseNumber(rewardSliderEls.devSignal && rewardSliderEls.devSignal.value, 1),
    };
  }

  function setRewardFeatureWeights(weights) {
    const w = weights || {};
    if (rewardSliderEls.realWordParts) rewardSliderEls.realWordParts.value = String(parseNumber(w.realWordParts, 1));
    if (rewardSliderEls.cpcKeywords) rewardSliderEls.cpcKeywords.value = String(parseNumber(w.cpcKeywords, 1));
    if (rewardSliderEls.cvFlow) rewardSliderEls.cvFlow.value = String(parseNumber(w.cvFlow, 1));
    if (rewardSliderEls.keywordMatch) rewardSliderEls.keywordMatch.value = String(parseNumber(w.keywordMatch, 1));
    if (rewardSliderEls.brandability) rewardSliderEls.brandability.value = String(parseNumber(w.brandability, 1));
    if (rewardSliderEls.memorability) rewardSliderEls.memorability.value = String(parseNumber(w.memorability, 1));
    if (rewardSliderEls.devSignal) rewardSliderEls.devSignal.value = String(parseNumber(w.devSignal, 1));
    updateRewardValueBadges();
  }

  function applyRewardPreset(presetName) {
    const key = String(presetName || 'balanced').toLowerCase();
    const preset = REWARD_PRESETS[key] || REWARD_PRESETS.balanced;
    setRewardFeatureWeights(preset);
  }

  function loadColumnPrefs() {
    try {
      const raw = localStorage.getItem(COLUMN_PREFS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveColumnPrefs() {
    try { localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(sectionColumnState)); } catch (_) {}
  }

  function getVisibleColumns(sectionId) {
    const options = SECTION_COLUMN_OPTIONS[sectionId] || [];
    const fallback = DEFAULT_SECTION_COLUMNS[sectionId] || options;
    const stored = Array.isArray(sectionColumnState[sectionId]) ? sectionColumnState[sectionId] : fallback;
    const filtered = stored.filter(function (k) { return options.includes(k); });
    return filtered.length ? filtered : fallback.slice();
  }

  function isColumnVisible(sectionId, key) {
    return getVisibleColumns(sectionId).includes(key);
  }

  function getColumnLabel(sectionId, key) {
    const labelMap = {
      'domain': 'Domain',
      'availability': 'Availability',
      'price': 'Price',
      'estimatedValue': 'Est. Value',
      'valueRatio': 'Value Ratio',
      'valueMetrics': 'Value Metrics',
      'finance': 'Finance',
      'quality': 'Quality',
      'signals': 'Signals',
      'words': 'Words',
      'notes': 'Notes',
      'realWordPartsScore': 'Real Word Parts',
      'cpcKeywordScore': 'CPC',
      'bestCpcTier': 'CPC Tier',
      'bestCpcWord': 'CPC Word',
      'cvFlowScore': 'CV Flow',
      'keywordMatchScore': 'Keyword Match',
      'devSignalScore': 'Dev Signal',
      'notesPriorityScore': 'Notes Priority',
      'loop': 'Loop',
      'keywords': 'Keywords',
      'strategy': 'Strategy',
      'explore': 'Explore',
      'quota': 'Quota',
      'results': 'Results',
      'top': 'Top',
      'sourceNote': 'Source/Note',
      'repetitionPenalty': 'Rep. Penalty',
      'reward': 'Reward',
      'featureWeights': 'Feature Weights',
      'rank': 'Rank',
      'word': 'Word',
      'state': 'State',
      'usage': 'Usage',
      'evidence': 'Evidence',
      'lastLoop': 'Last Loop',
    };
    return labelMap[key] || key;
  }

  function openColumnPicker(sectionId) {
    const options = SECTION_COLUMN_OPTIONS[sectionId] || [];
    if (!options.length) return;
    const current = getVisibleColumns(sectionId);
    
    const modal = document.createElement('div');
    modal.className = 'column-picker-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'column-picker-title');
    
    const sectionName = sectionId.replace(/-table$/, '').replace(/-/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });
    
    modal.innerHTML = `
      <div class="column-picker-dialog">
        <div class="column-picker-header">
          <h3 id="column-picker-title">Column Configuration: ${sectionName}</h3>
          <button type="button" class="column-picker-close" aria-label="Close">&times;</button>
        </div>
        <div class="column-picker-body">
          <p class="column-picker-hint">Drag to reorder, check/uncheck to show/hide columns</p>
          <ul class="column-picker-list" id="column-picker-list"></ul>
        </div>
        <div class="column-picker-footer">
          <button type="button" class="btn btn-secondary" id="column-picker-reset">Reset to Default</button>
          <div class="column-picker-actions">
            <button type="button" class="btn btn-secondary" id="column-picker-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="column-picker-save">Save</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    const listEl = modal.querySelector('#column-picker-list');
    const closeBtn = modal.querySelector('.column-picker-close');
    const cancelBtn = modal.querySelector('#column-picker-cancel');
    const saveBtn = modal.querySelector('#column-picker-save');
    const resetBtn = modal.querySelector('#column-picker-reset');
    
    let workingOrder = current.slice();
    let workingChecked = new Set(workingOrder);
    let draggedElement = null;
    
    function renderList() {
      listEl.innerHTML = '';
      options.forEach(function (key) {
        const li = document.createElement('li');
        li.className = 'column-picker-item';
        li.draggable = true;
        li.dataset.key = key;
        if (!workingChecked.has(key)) {
          li.classList.add('column-picker-item-hidden');
        }
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'col-' + key;
        checkbox.checked = workingChecked.has(key);
        checkbox.addEventListener('change', function () {
          if (checkbox.checked) {
            workingChecked.add(key);
            li.classList.remove('column-picker-item-hidden');
            if (!workingOrder.includes(key)) {
              workingOrder.push(key);
            }
          } else {
            workingChecked.delete(key);
            li.classList.add('column-picker-item-hidden');
          }
        });
        
        const label = document.createElement('label');
        label.htmlFor = 'col-' + key;
        label.textContent = getColumnLabel(sectionId, key);
        
        const dragHandle = document.createElement('span');
        dragHandle.className = 'column-picker-drag-handle';
        dragHandle.textContent = '☰';
        dragHandle.setAttribute('aria-label', 'Drag to reorder');
        
        li.appendChild(checkbox);
        li.appendChild(label);
        li.appendChild(dragHandle);
        
        li.addEventListener('dragstart', function (e) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', key);
          li.classList.add('column-picker-item-dragging');
          draggedElement = li;
        });
        
        li.addEventListener('dragend', function () {
          li.classList.remove('column-picker-item-dragging');
          draggedElement = null;
        });
        
        li.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!draggedElement || draggedElement === li) return;
          const afterElement = getDragAfterElement(listEl, e.clientY);
          if (afterElement == null) {
            listEl.appendChild(draggedElement);
          } else {
            listEl.insertBefore(draggedElement, afterElement);
          }
        });
        
        li.addEventListener('drop', function (e) {
          e.preventDefault();
          updateOrderFromDOM();
        });
        
        listEl.appendChild(li);
      });
      updateOrderFromDOM();
    }
    
    function getDragAfterElement(container, y) {
      const draggableElements = Array.from(container.querySelectorAll('.column-picker-item:not(.column-picker-item-dragging)'));
      return draggableElements.reduce(function (closest, child) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
    
    function updateOrderFromDOM() {
      const items = Array.from(listEl.querySelectorAll('.column-picker-item'));
      workingOrder = items.map(function (li) { return li.dataset.key; }).filter(function (key) { return workingChecked.has(key); });
      const unchecked = options.filter(function (key) { return !workingChecked.has(key); });
      workingOrder = workingOrder.concat(unchecked);
    }
    
    function closeModal() {
      document.body.removeChild(modal);
    }
    
    function saveAndClose() {
      const visible = Array.from(workingChecked);
      const ordered = workingOrder.filter(function (key) { return visible.includes(key); });
      if (ordered.length === 0) {
        alert('At least one column must be visible.');
        return;
      }
      sectionColumnState[sectionId] = ordered;
      saveColumnPrefs();
      if (currentResults) renderResults(currentResults);
      closeModal();
    }
    
    function resetToDefault() {
      const defaultCols = DEFAULT_SECTION_COLUMNS[sectionId] || options;
      workingOrder = options.slice();
      workingChecked = new Set(defaultCols);
      renderList();
    }
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    saveBtn.addEventListener('click', saveAndClose);
    resetBtn.addEventListener('click', resetToDefault);
    
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeModal();
      }
    });
    
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeModal();
      }
    });
    
    renderList();
    saveBtn.focus();
  }

  function paginateRows(sectionId, rows) {
    const allRows = Array.isArray(rows) ? rows : [];
    if (!tablePageState[sectionId]) tablePageState[sectionId] = 1;
    const totalPages = Math.max(1, Math.ceil(allRows.length / TABLE_PAGE_SIZE));
    const page = Math.max(1, Math.min(totalPages, Number(tablePageState[sectionId]) || 1));
    tablePageState[sectionId] = page;
    const start = (page - 1) * TABLE_PAGE_SIZE;
    const end = start + TABLE_PAGE_SIZE;
    return { page: page, totalPages: totalPages, totalRows: allRows.length, rows: allRows.slice(start, end) };
  }

  function renderPager(sectionId, pageMeta) {
    if (!pageMeta || pageMeta.totalPages <= 1) return '';
    return `
      <div class="table-pager">
        <button type="button" class="btn btn-sm pager-btn" data-section-id="${sectionId}" data-page-action="prev" ${pageMeta.page <= 1 ? 'disabled' : ''}>Prev</button>
        <span>Page ${pageMeta.page}/${pageMeta.totalPages} (${pageMeta.totalRows.toLocaleString()} rows)</span>
        <button type="button" class="btn btn-sm pager-btn" data-section-id="${sectionId}" data-page-action="next" ${pageMeta.page >= pageMeta.totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
  }

  function normalizeFilterTerm(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function parseFilterTerms(value) {
    return String(value || '')
      .split(/[,\n\r;]+/)
      .map(function (part) { return normalizeFilterTerm(part); })
      .filter(Boolean);
  }

  function getDomainFilterState() {
    return {
      include: parseFilterTerms(domainFilterIncludeEl && domainFilterIncludeEl.value),
      exclude: parseFilterTerms(domainFilterExcludeEl && domainFilterExcludeEl.value),
    };
  }

  function rowMatchesDomainFilters(row, filters) {
    const f = filters || getDomainFilterState();
    if (!row) return false;
    const domain = String(row.domain || '').toLowerCase();
    const sourceName = String(row.sourceName || '').toLowerCase();
    const haystack = normalizeFilterTerm(domain + ' ' + sourceName);
    if (f.include.length > 0 && !f.include.some(function (term) { return haystack.includes(term); })) return false;
    if (f.exclude.some(function (term) { return haystack.includes(term); })) return false;
    return true;
  }

  function applyDomainFilters(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const filters = getDomainFilterState();
    if (!filters.include.length && !filters.exclude.length) return list;
    return list.filter(function (row) { return rowMatchesDomainFilters(row, filters); });
  }

  function updateDomainFilterStatus(totalRows, shownRows) {
    if (!domainFilterStatusEl) return;
    const include = parseFilterTerms(domainFilterIncludeEl && domainFilterIncludeEl.value);
    const exclude = parseFilterTerms(domainFilterExcludeEl && domainFilterExcludeEl.value);
    if (!include.length && !exclude.length) {
      domainFilterStatusEl.textContent = '';
      return;
    }
    domainFilterStatusEl.textContent = `Filtered ${Number(shownRows || 0).toLocaleString()} / ${Number(totalRows || 0).toLocaleString()} rows`;
  }

  function resetDomainTablePages() {
    ['all-ranked-table', 'within-budget-table', 'unavailable-table'].forEach(function (id) {
      tablePageState[id] = 1;
    });
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
    diagnostics: {
      running: false,
      completedAt: null,
      issues: [],
    },
    nameGeneration: null,
    availability: null,
    synonymApi: null,
    githubApi: null,
    devEcosystem: null,
    persistence: null,
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
    if (dataSourceState.devEcosystem && Number(dataSourceState.devEcosystem.githubCalls || 0) > 0 && Number(dataSourceState.devEcosystem.githubSuccess || 0) === 0 && dataSourceState.devEcosystem.githubTokenUsed) {
      issues.push('GitHub enrichment calls failed');
    }
    if (dataSourceState.availability && (dataSourceState.availability.syntheticData || Number(dataSourceState.availability.status || 0) >= 400)) {
      issues.push('Availability API abnormal');
    }
    if (dataSourceState.nameGeneration && dataSourceState.nameGeneration.namelixApiCalled === false && BACKEND_URL) {
      issues.push('Namelix API unavailable');
    }
    return issues;
  }

  function ensureDataSourceExpandedForIssues() {
    // User-controlled only; keep collapsed unless user expands explicitly.
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

  async function loadPersistentRunProfile(reason) {
    const base = String(BACKEND_URL || '').trim().replace(/\/+$/, '');
    if (!base) return;
    try {
      const resp = await fetchJsonWithTimeout(`${base}/api/runs/profile?limit=15`, { method: 'GET' }, 7000);
      if (!resp.response || !resp.response.ok || !resp.json || resp.json.enabled !== true) {
        dataSourceState.persistence = {
          enabled: false,
          reason: (resp.json && resp.json.message) ? String(resp.json.message) : 'Profile endpoint unavailable',
        };
        renderDataSourcePanel();
        return;
      }
      persistentRewardPolicy = resp.json.rewardPolicy && typeof resp.json.rewardPolicy === 'object' ? resp.json.rewardPolicy : null;
      persistentRewardPolicyMeta = resp.json.rewardPolicyMeta && typeof resp.json.rewardPolicyMeta === 'object' ? resp.json.rewardPolicyMeta : null;
      if (persistentRewardPolicy && persistentRewardPolicy.featureWeights) {
        setRewardFeatureWeights(persistentRewardPolicy.featureWeights);
      }
      dataSourceState.persistence = {
        enabled: true,
        runCount: Number(resp.json.runCount || 0),
        topUndervaluedCount: Array.isArray(resp.json.topUndervaluedDomains) ? resp.json.topUndervaluedDomains.length : 0,
        rewardPolicyMeta: persistentRewardPolicyMeta,
      };
      pushDebugLog('app.js:loadPersistentRunProfile', 'Loaded persistent run profile', {
        reason: reason || 'unknown',
        runCount: dataSourceState.persistence.runCount,
        hasRewardPolicy: Boolean(persistentRewardPolicy),
      });
      renderDataSourcePanel();
    } catch (err) {
      dataSourceState.persistence = {
        enabled: false,
        reason: err && err.message ? err.message : String(err || 'profile load failed'),
      };
      renderDataSourcePanel();
    }
  }

  async function ingestCompletedRun(job, input) {
    const base = String(BACKEND_URL || '').trim().replace(/\/+$/, '');
    if (!base || !job || !job.id || !job.results) return;
    if (persistedRunIds.has(job.id)) return;
    persistedRunIds.add(job.id);
    try {
      const payload = {
        runId: String(job.id),
        run: {
          id: job.id,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
          totalLoops: job.totalLoops,
          status: job.status,
        },
        input: input || currentInput || {},
        results: {
          withinBudget: Array.isArray(job.results.withinBudget) ? job.results.withinBudget.slice(0, 1200) : [],
          allRanked: Array.isArray(job.results.allRanked) ? job.results.allRanked.slice(0, 1500) : [],
          loopSummaries: Array.isArray(job.results.loopSummaries) ? job.results.loopSummaries.slice(0, 500) : [],
          tuningHistory: Array.isArray(job.results.tuningHistory) ? job.results.tuningHistory.slice(0, 500) : [],
        },
      };
      const resp = await fetchJsonWithTimeout(`${base}/api/runs/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 12000);
      if (resp.response && resp.response.ok && resp.json && resp.json.ok) {
        if (resp.json.rewardPolicy && typeof resp.json.rewardPolicy === 'object') persistentRewardPolicy = resp.json.rewardPolicy;
        if (resp.json.rewardPolicyMeta && typeof resp.json.rewardPolicyMeta === 'object') persistentRewardPolicyMeta = resp.json.rewardPolicyMeta;
        dataSourceState.persistence = {
          enabled: true,
          runCount: persistentRewardPolicyMeta && Number.isFinite(Number(persistentRewardPolicyMeta.runCount)) ? Number(persistentRewardPolicyMeta.runCount) : (dataSourceState.persistence && dataSourceState.persistence.runCount ? dataSourceState.persistence.runCount : 0),
          topUndervaluedCount: dataSourceState.persistence && dataSourceState.persistence.topUndervaluedCount ? dataSourceState.persistence.topUndervaluedCount : 0,
          rewardPolicyMeta: persistentRewardPolicyMeta,
        };
        renderDataSourcePanel();
      }
    } catch (_) {}
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
        const gh = await fetchJsonWithTimeout('https://api.github.com/rate_limit', { method: 'GET', headers: { Accept: 'application/vnd.github+json' } }, 7000);
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
          tokenUsed: false,
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
          tokenUsed: false,
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

        try {
          const dev = await fetchJsonWithTimeout(`${backendBaseUrl}/api/dev-ecosystem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: ['cloud', 'fintech'] }),
          }, 8000);
          const scoresObj = dev.json && dev.json.scores && typeof dev.json.scores === 'object' ? dev.json.scores : null;
          const debug = dev.json && dev.json._debug && typeof dev.json._debug === 'object' ? dev.json._debug : null;
          const ok = Boolean(dev.response && dev.response.ok && scoresObj);
          dataSourceState.devEcosystem = {
            attemptedWords: scoresObj ? Object.keys(scoresObj).length : 0,
            fetchedWords: scoresObj ? Object.keys(scoresObj).length : 0,
            cacheHits: 0,
            mode: 'backend-preflight',
            githubTokenUsed: Boolean(debug && debug.githubTokenPresent),
            githubCalls: debug ? Number(debug.githubCalls || 0) : 0,
            githubSuccess: debug ? Number(debug.githubSuccess || 0) : 0,
            githubFailures: debug ? Number(debug.githubFailures || 0) : 0,
            npmCalls: debug ? Number(debug.npmCalls || 0) : 0,
            npmSuccess: debug ? Number(debug.npmSuccess || 0) : 0,
            npmFailures: debug ? Number(debug.npmFailures || 0) : 0,
            backendAttempted: true,
            backendUsed: ok,
            backendStatus: dev.response ? dev.response.status : null,
            sampleWords: scoresObj
              ? Object.keys(scoresObj).slice(0, 5).map(function (w) {
                const details = dev.json && dev.json.details && dev.json.details[w] ? dev.json.details[w] : null;
                return {
                  word: w,
                  total: Number(scoresObj[w] || 0),
                  githubRepos: details && details.githubRepos != null ? Number(details.githubRepos) : null,
                  npmPackages: details && details.npmPackages != null ? Number(details.npmPackages) : null,
                };
              })
              : [],
          };
          if (!ok) {
            issues.push('GitHub evaluation preflight failed');
          } else if (dataSourceState.devEcosystem.githubCalls > 0 && dataSourceState.devEcosystem.githubSuccess === 0 && dataSourceState.devEcosystem.githubTokenUsed) {
            issues.push('GitHub evaluation preflight abnormal');
          }
        } catch (err) {
          const msg = err && err.message ? err.message : String(err || 'unknown error');
          dataSourceState.devEcosystem = {
            attemptedWords: 0,
            fetchedWords: 0,
            cacheHits: 0,
            mode: 'backend-preflight',
            githubTokenUsed: false,
            githubCalls: 0,
            githubSuccess: 0,
            githubFailures: 0,
            npmCalls: 0,
            npmSuccess: 0,
            npmFailures: 0,
            backendAttempted: true,
            backendUsed: false,
            backendStatus: null,
            sampleWords: [],
            error: msg,
          };
          issues.push('GitHub evaluation preflight failed');
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

    if (msg === 'Developer ecosystem scoring complete' || msg === 'Developer ecosystem scoring via backend' || msg === 'Developer ecosystem scoring (cache hit)') {
      dataSourceState.devEcosystem = {
        attemptedWords: Number(d.attemptedWords || 0),
        fetchedWords: Number(d.fetchedWords || 0),
        cacheHits: Number(d.cacheHits || 0),
        mode: d.mode || 'unknown',
        githubTokenUsed: Boolean(d.githubTokenUsed),
        githubCalls: Number(d.githubCalls || 0),
        githubSuccess: Number(d.githubSuccess || 0),
        githubFailures: Number(d.githubFailures || 0),
        npmCalls: Number(d.npmCalls || 0),
        npmSuccess: Number(d.npmSuccess || 0),
        npmFailures: Number(d.npmFailures || 0),
        backendAttempted: Boolean(d.backendAttempted),
        backendUsed: Boolean(d.backendUsed),
        backendStatus: d.backendStatus == null ? null : Number(d.backendStatus),
        sampleWords: Array.isArray(d.sampleWords) ? d.sampleWords.slice(0, 8) : [],
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
      if (gh.limit != null) bodyParts.push('<br>Rate limit: <strong>' + gh.remaining + '</strong> / ' + gh.limit);
      if (gh.error) bodyParts.push('<br><span class="bad">Error: ' + escapeHtml(String(gh.error)) + '</span>');
      if (gh.abnormal) bodyParts.push('<br><span class="warn">Abnormal result detected.</span>');
      bodyParts.push('</div>');
    }

    if (dataSourceState.persistence) {
      const ps = dataSourceState.persistence;
      bodyParts.push('<div class="ds-block">');
      bodyParts.push('<strong>Persistent Learning DB:</strong> ');
      bodyParts.push('<span class="' + (ps.enabled ? 'good' : 'warn') + '">' + (ps.enabled ? 'ENABLED' : 'DISABLED') + '</span>');
      if (ps.runCount != null) bodyParts.push('<br>Stored runs: <strong>' + escapeHtml(String(ps.runCount)) + '</strong>');
      if (ps.topUndervaluedCount != null) bodyParts.push('<br>Tracked undervalued domains: <strong>' + escapeHtml(String(ps.topUndervaluedCount)) + '</strong>');
      if (ps.rewardPolicyMeta) {
        const rpm = ps.rewardPolicyMeta;
        if (rpm.updatedAt) bodyParts.push('<br>Policy updated: <code>' + escapeHtml(new Date(Number(rpm.updatedAt)).toISOString()) + '</code>');
        if (rpm.movingCoverage != null) bodyParts.push('<br>Moving coverage: <strong>' + escapeHtml(formatScore(Number(rpm.movingCoverage) * 100, 1)) + '%</strong>');
        if (rpm.movingPerformance != null) bodyParts.push('<br>Moving performance: <strong>' + escapeHtml(formatScore(Number(rpm.movingPerformance) * 100, 1)) + '%</strong>');
      }
      if (ps.reason) bodyParts.push('<br><span class="warn">' + escapeHtml(String(ps.reason)) + '</span>');
      bodyParts.push('</div>');
    }

    if (dataSourceState.devEcosystem) {
      const de = dataSourceState.devEcosystem;
      bodyParts.push('<div class="ds-block">');
      bodyParts.push('<strong>GitHub Value Evidence:</strong> ');
      bodyParts.push('<span class="' + (de.githubSuccess > 0 ? 'good' : 'warn') + '">' + escapeHtml(String(de.mode || 'unknown')) + '</span>');
      bodyParts.push('<br>Words queried: <strong>' + escapeHtml(String(de.attemptedWords)) + '</strong> (fetched ' + escapeHtml(String(de.fetchedWords)) + ', cache hits ' + escapeHtml(String(de.cacheHits)) + ')');
      bodyParts.push('<br>GitHub calls: <strong>' + escapeHtml(String(de.githubSuccess)) + '</strong> / ' + escapeHtml(String(de.githubCalls)) + ' success');
      bodyParts.push('<br>npm calls: <strong>' + escapeHtml(String(de.npmSuccess)) + '</strong> / ' + escapeHtml(String(de.npmCalls)) + ' success');
      if (de.backendAttempted) bodyParts.push('<br>Backend attempted: <strong>YES</strong> (status ' + escapeHtml(String(de.backendStatus == null ? '-' : de.backendStatus)) + ')');
      if (de.backendUsed) bodyParts.push('<br>Backend used: <strong>YES</strong>');
      if (Array.isArray(de.sampleWords) && de.sampleWords.length) {
        bodyParts.push('<br>Sample evidence:<ul class="ds-errors">');
        de.sampleWords.forEach(function (w) {
          bodyParts.push('<li>' + escapeHtml(String(w.word || '?')) + ': total=' + escapeHtml(String(w.total == null ? '-' : w.total)) + ', GH=' + escapeHtml(String(w.githubRepos == null ? '-' : w.githubRepos)) + ', npm=' + escapeHtml(String(w.npmPackages == null ? '-' : w.npmPackages)) + '</li>');
        });
        bodyParts.push('</ul>');
      }
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
    if (debugLogs.length > currentDebugLogsMax) {
      debugLogs.splice(0, debugLogs.length - currentDebugLogsMax);
    }
  }

  function cloneForExport(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  }

  function escapeCsvCell(value) {
    if (value == null) return '';
    const s = String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function getCsvValue(row, key) {
    if (row == null || key == null) return '';
    const parts = String(key).split('.');
    let v = row;
    for (let i = 0; i < parts.length && v != null; i++) v = v[parts[i]];
    return v == null ? '' : v;
  }

  function rowsToCsv(rows, columns, skipBom) {
    if (!columns || columns.length === 0) return '';
    const header = columns.map(function (c) { return escapeCsvCell(c.label || c.key); }).join(',');
    const body = (rows || []).map(function (row) {
      return columns.map(function (c) { return escapeCsvCell(getCsvValue(row, c.key)); }).join(',');
    }).join('\r\n');
    return (skipBom ? '' : '\uFEFF') + header + '\r\n' + body;
  }

  var CSV_DOMAIN_COLUMNS = [
    { key: 'domain', label: 'Domain' },
    { key: 'available', label: 'Availability' },
    { key: 'price', label: 'Price' },
    { key: 'currency', label: 'Currency' },
    { key: 'estimatedValueUSD', label: 'Estimated Value USD' },
    { key: 'valueRatio', label: 'Value Ratio' },
    { key: 'intrinsicValue', label: 'Intrinsic Value' },
    { key: 'liquidityScore', label: 'Liquidity Score' },
    { key: 'marketabilityScore', label: 'Marketability Score' },
    { key: 'ev24m', label: 'EV 24m' },
    { key: 'expectedROI', label: 'Expected ROI' },
    { key: 'phoneticScore', label: 'Phonetic Score' },
    { key: 'brandabilityScore', label: 'Brandability Score' },
    { key: 'seoScore', label: 'SEO Score' },
    { key: 'commercialScore', label: 'Commercial Score' },
    { key: 'realWordPartsScore', label: 'Real Word Parts Score' },
    { key: 'cpcKeywordScore', label: 'CPC Keyword Score' },
    { key: 'bestCpcTier', label: 'Best CPC Tier' },
    { key: 'bestCpcWord', label: 'Best CPC Word' },
    { key: 'cvFlowScore', label: 'CV Flow Score' },
    { key: 'keywordMatchScore', label: 'Keyword Match Score' },
    { key: 'devSignalScore', label: 'Dev Signal Score' },
    { key: 'notesPriorityScore', label: 'Notes Priority Score' },
    { key: 'devEcosystemScore', label: 'Dev Ecosystem Score' },
    { key: 'devEcosystemEvidence.githubRepos', label: 'GitHub Repos' },
    { key: 'devEcosystemEvidence.npmPackages', label: 'NPM Packages' },
    { key: 'hasArchiveHistory', label: 'Has Archive History' },
    { key: 'syllableCount', label: 'Syllable Count' },
    { key: 'labelLength', label: 'Label Length' },
    { key: '_segmentedWordsStr', label: 'Segmented Words' },
    { key: '_valueDriversStr', label: 'Value Drivers' },
    { key: '_valueDetractorsStr', label: 'Value Detractors' },
    { key: 'underpricedFlag', label: 'Underpriced Flag' },
  ];

  function domainRowForCsv(row) {
    var r = Object.assign({}, row);
    r._segmentedWordsStr = Array.isArray(row.segmentedWords) ? row.segmentedWords.join(' ') : '';
    r._valueDriversStr = row.valueDriversSummary || (row.valueDrivers || []).slice(0, 5).map(function (x) { return (x.component || '') + ' (' + formatScore(x.impact, 1) + ')'; }).join(', ');
    r._valueDetractorsStr = row.valueDetractorsSummary || (row.valueDetractors || []).slice(0, 5).map(function (x) { return (x.component || '') + ' (' + formatScore(x.impact, 1) + ')'; }).join(', ');
    return r;
  }

  var CSV_LOOP_SUMMARY_COLUMNS = [
    { key: 'loop', label: 'Loop' },
    { key: '_keywordsPlain', label: 'Keywords' },
    { key: 'style', label: 'Style' },
    { key: 'randomness', label: 'Randomness' },
    { key: 'mutationIntensity', label: 'Mutation Intensity' },
    { key: 'explorationRate', label: 'Exploration Rate' },
    { key: 'elitePoolSize', label: 'Elite Pool Size' },
    { key: 'curatedCoveragePct', label: 'Curated Coverage Pct' },
    { key: 'curatedCoverageTargetPct', label: 'Curated Coverage Target Pct' },
    { key: 'requiredQuota', label: 'Required Quota' },
    { key: 'withinBudgetCount', label: 'Within Budget Count' },
    { key: 'overBudgetCount', label: 'Over Budget Count' },
    { key: 'consideredCount', label: 'Considered Count' },
    { key: 'averageOverallScore', label: 'Average Overall Score' },
    { key: 'topDomain', label: 'Top Domain' },
    { key: 'topScore', label: 'Top Score' },
    { key: 'nameSource', label: 'Name Source' },
    { key: 'skipReason', label: 'Skip Reason' },
    { key: 'quotaMet', label: 'Quota Met' },
  ];

  var CSV_TUNING_COLUMNS = [
    { key: 'loop', label: 'Loop' },
    { key: '_keywordsPlain', label: 'Keywords' },
    { key: 'sourceLoop', label: 'Source Loop' },
    { key: 'selectedStyle', label: 'Selected Style' },
    { key: 'selectedRandomness', label: 'Selected Randomness' },
    { key: 'selectedMutationIntensity', label: 'Selected Mutation Intensity' },
    { key: 'explorationRate', label: 'Exploration Rate' },
    { key: 'elitePoolSize', label: 'Elite Pool Size' },
    { key: 'repetitionPenaltyApplied', label: 'Repetition Penalty Applied' },
    { key: 'featureWeights.realWordParts', label: 'FW Real Word Parts' },
    { key: 'featureWeights.cpcKeywords', label: 'FW CPC Keywords' },
    { key: 'featureWeights.cvFlow', label: 'FW CV Flow' },
    { key: 'featureWeights.keywordMatch', label: 'FW Keyword Match' },
    { key: 'featureWeights.brandability', label: 'FW Brandability' },
    { key: 'featureWeights.memorability', label: 'FW Memorability' },
    { key: 'featureWeights.devSignal', label: 'FW Dev Signal' },
    { key: 'reward', label: 'Reward' },
  ];

  var CSV_KEYWORD_LIBRARY_COLUMNS = [
    { key: 'rank', label: 'Rank' },
    { key: 'token', label: 'Token' },
    { key: 'source', label: 'Source' },
    { key: 'inCurrentKeywords', label: 'In Current Keywords' },
    { key: 'plays', label: 'Plays' },
    { key: 'avgReward', label: 'Avg Reward' },
    { key: 'successRate', label: 'Success Rate' },
    { key: 'performanceScore', label: 'Performance Score' },
    { key: 'selectionScore', label: 'Selection Score' },
    { key: 'confidence', label: 'Confidence' },
    { key: 'githubRepos', label: 'GitHub Repos' },
    { key: 'npmPackages', label: 'NPM Packages' },
    { key: 'githubPrior', label: 'GitHub Prior' },
    { key: 'meanDomainScore', label: 'Mean Domain Score' },
    { key: 'lastLoop', label: 'Last Loop' },
  ];

  function getSectionRowsAndColumns(sectionId, results, sortMode) {
    if (!results) return { rows: [], columns: [] };
    var rows = [];
    var columns = [];
    var allRanked = results.allRanked || [];
    var pending = results.pending || [];
    var pendingRows = pending.map(function (p) {
      var label = String(p.domain || '').split('.')[0];
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
        realWordPartsScore: 0,
        cpcKeywordScore: 0,
        bestCpcTier: 0,
        bestCpcWord: '',
        cvFlowScore: 0,
        keywordMatchScore: 0,
        devSignalScore: 0,
        notesPriorityScore: 0,
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
        valueDriversSummary: '',
        valueDetractorsSummary: '',
        _pending: true,
      };
    });
    var combinedRanked = allRanked.concat(pendingRows);
    if (sectionId === 'all-ranked-table') {
      rows = sortRows(applyDomainFilters(combinedRanked), sortMode).map(domainRowForCsv);
      columns = CSV_DOMAIN_COLUMNS.filter(function (c) { return c.key !== 'available'; });
    } else if (sectionId === 'within-budget-table') {
      rows = sortRows(applyDomainFilters(results.withinBudget || []), sortMode).map(domainRowForCsv);
      columns = CSV_DOMAIN_COLUMNS.filter(function (c) { return c.key !== 'available'; });
    } else if (sectionId === 'unavailable-table') {
      rows = sortRows(applyDomainFilters(results.unavailable || []), sortMode).map(domainRowForCsv);
      columns = CSV_DOMAIN_COLUMNS;
    } else if (sectionId === 'loop-summary-table') {
      rows = (results.loopSummaries || []).map(function (r) {
        var plain = sortKeywordsForDisplay(r.keywords || '');
        return Object.assign({}, r, { _keywordsPlain: plain });
      });
      columns = CSV_LOOP_SUMMARY_COLUMNS;
    } else if (sectionId === 'tuning-table') {
      rows = (results.tuningHistory || []).map(function (r) {
        var plain = sortKeywordsForDisplay(r.keywords || '');
        return Object.assign({}, r, { _keywordsPlain: plain });
      });
      columns = CSV_TUNING_COLUMNS;
    } else if (sectionId === 'keyword-library-table') {
      rows = Array.isArray(results.keywordLibrary && results.keywordLibrary.tokens) ? results.keywordLibrary.tokens : [];
      columns = CSV_KEYWORD_LIBRARY_COLUMNS;
    }
    var visible = getVisibleColumns(sectionId);
    if (visible && visible.length && columns && columns.length) {
      var keyMap = {};
      if (sectionId === 'all-ranked-table' || sectionId === 'within-budget-table' || sectionId === 'unavailable-table') {
        keyMap = {
          estimatedValue: 'estimatedValueUSD',
          notes: '_valueDriversStr',
          words: '_segmentedWordsStr',
          valueMetrics: 'intrinsicValue',
          finance: 'ev24m',
          quality: 'phoneticScore',
          signals: 'devEcosystemScore',
          availability: 'available',
        };
      } else if (sectionId === 'loop-summary-table') {
        keyMap = { keywords: '_keywordsPlain', strategy: 'style', explore: 'explorationRate', quota: 'requiredQuota', results: 'averageOverallScore', top: 'topDomain', sourceNote: 'nameSource' };
      } else if (sectionId === 'tuning-table') {
        keyMap = { keywords: '_keywordsPlain', strategy: 'selectedStyle', explore: 'explorationRate', repetitionPenalty: 'repetitionPenaltyApplied', featureWeights: 'featureWeights.realWordParts' };
      } else if (sectionId === 'keyword-library-table') {
        keyMap = { word: 'token', state: 'source', usage: 'plays', evidence: 'selectionScore', lastLoop: 'lastLoop' };
      }
      var visibleCsv = visible.map(function (k) { return keyMap[k] || k; });
      var filteredCols = columns.filter(function (c) { return visibleCsv.includes(c.key); });
      if (filteredCols.length) columns = filteredCols;
    }
    return { rows: rows, columns: columns };
  }

  function getSectionCsv(sectionId, results, sortMode) {
    var data = getSectionRowsAndColumns(sectionId, results, sortMode);
    return rowsToCsv(data.rows, data.columns);
  }

  function getFullCsv(results, sortMode) {
    var sections = [
      { id: 'all-ranked-table', title: 'All Ranked Available Domains' },
      { id: 'within-budget-table', title: 'Within Budget' },
      { id: 'unavailable-table', title: 'Unavailable' },
      { id: 'loop-summary-table', title: 'Loop Summaries' },
      { id: 'keyword-library-table', title: 'Keyword Library (Live)' },
      { id: 'tuning-table', title: 'Tuning History' },
    ];
    var parts = [];
    for (var i = 0; i < sections.length; i++) {
      var data = getSectionRowsAndColumns(sections[i].id, results, sortMode);
      if (data.rows.length > 0) {
        parts.push(escapeCsvCell('[' + sections[i].title + ']'));
        parts.push(rowsToCsv(data.rows, data.columns, true));
      }
    }
    return parts.length ? '\uFEFF' + parts.join('\r\n\r\n') : '';
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
        githubRepos: row.githubRepos == null ? null : Number(row.githubRepos),
        npmPackages: row.npmPackages == null ? null : Number(row.npmPackages),
        githubPrior: row.githubPrior == null ? null : Number(row.githubPrior),
      });
    }
    return out;
  }

  function sortKeywordsForDisplay(text) {
    const raw = String(text || '').trim();
    if (!raw) return raw;
    const tokens = raw.split(/\s+/).filter(Boolean);
    return tokens.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).join(' ');
  }

  function renderPerformancePhrase(text, perfLookup) {
    const raw = String(text || '').trim();
    if (!raw) return '-';
    const sorted = sortKeywordsForDisplay(raw);
    if (!(perfLookup instanceof Map) || perfLookup.size === 0) return escapeHtml(sorted);

    const parts = sorted.split(/(\s+)/);
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
        `GitHub ${m.githubRepos == null ? '-' : Number(m.githubRepos).toLocaleString()}`,
        `npm ${m.npmPackages == null ? '-' : Number(m.npmPackages).toLocaleString()}`,
        `GH Prior ${m.githubPrior == null ? '-' : formatScore(m.githubPrior, 1)}`,
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
    const underpricedCount = allRanked.filter(r => r.underpricedFlag).length;
    const avgEstValue = allRanked.filter(r => r.estimatedValueUSD > 0).reduce((s, r) => s + r.estimatedValueUSD, 0) / Math.max(1, allRanked.filter(r => r.estimatedValueUSD > 0).length);
    const bestRatio = allRanked.reduce((best, r) => Math.max(best, r.valueRatio || 0), 0);
    const liveCoverage = results.keywordLibrary && results.keywordLibrary.coverageMetrics ? results.keywordLibrary.coverageMetrics : null;
    const loopSummaries = Array.isArray(results.loopSummaries) ? results.loopSummaries : [];
    const latestLoop = loopSummaries.length ? loopSummaries[loopSummaries.length - 1] : null;
    // Use loop summary whenever we have any completed loop so the metric updates every loop; fall back to keywordLibrary.coverageMetrics only before any loop.
    const useLoopCoverage = !!latestLoop;
    const curatedCoveragePct = useLoopCoverage ? Number(latestLoop.curatedCoveragePct || 0) : (liveCoverage ? Number(liveCoverage.coveragePct || 0) : 0);
    const curatedCoverageTargetPct = useLoopCoverage ? Number(latestLoop.curatedCoverageTargetPct || 0) : (liveCoverage ? Number(liveCoverage.coverageTargetPct || 0) : 0);
    const curatedCoverageAssessed = useLoopCoverage ? Number(latestLoop.curatedCoverageAssessed || 0) : (liveCoverage ? Number(liveCoverage.assessedTarget || 0) : 0);
    const curatedCoverageTotal = useLoopCoverage ? Number(latestLoop.curatedCoverageTotal || 0) : (liveCoverage ? Number(liveCoverage.total || 0) : 0);
    const hasCuratedCoverageData = useLoopCoverage || (curatedCoverageTotal > 0);
    const curatedCoverageValue = hasCuratedCoverageData
      ? `${formatScore(curatedCoveragePct, 1)}% | target ${formatScore(curatedCoverageTargetPct, 1)}% (${curatedCoverageAssessed}/${curatedCoverageTotal})`
      : '-';

    summaryKpisEl.innerHTML = [
      { label: 'Ranked Domains', value: String(allRanked.length) },
      { label: 'Within Budget', value: String(positiveBudget) },
      { label: 'Underpriced', value: String(underpricedCount) },
      { label: 'Avg Est. Value', value: avgEstValue > 0 ? '$' + Math.round(avgEstValue).toLocaleString() : '-' },
      { label: 'Best Value Ratio', value: bestRatio > 0 ? formatScore(bestRatio, 1) + 'x' : '-' },
      { label: 'Curated Coverage', value: curatedCoverageValue },
      { label: 'Avg Intrinsic', value: formatScore(avg('intrinsicValue'), 1) },
      { label: 'Avg Liquidity', value: formatScore(avg('liquidityScore'), 0) },
      { label: 'Top Domain', value: top ? escapeHtml(top.domain) : '-' },
    ]
      .map((item) => `<article class="summary-card"><span>${item.label}</span><strong>${item.value}</strong></article>`)
      .join('');
  }

  function renderDomainTable(rows, includeAvailability, sectionId) {
    if (!rows || rows.length === 0) {
      return '<p>No rows.</p>';
    }
    const sec = sectionId || 'all-ranked-table';
    const show = function (key) { return isColumnVisible(sec, key); };
    const headerCells = [];
    if (show('domain')) headerCells.push(th('Domain', 'The full candidate domain name including TLD.'));
    if ((includeAvailability || show('availability')) && show('availability')) headerCells.push(th('Availability', 'Current availability status for this domain based on API response.'));
    if (show('price')) headerCells.push(th('Price', 'Year-1 registration price from availability provider.'));
    if (show('estimatedValue')) headerCells.push(th('Est. Value', 'Model-estimated resale value in USD.'));
    if (show('valueRatio')) headerCells.push(th('Value Ratio', 'Estimated value divided by current price; higher suggests more upside.'));
    if (show('valueMetrics')) headerCells.push(th('Value Metrics', 'Compact view: Intrinsic, Liquidity, and Marketability.'));
    if (show('finance')) headerCells.push(th('Finance', 'Compact view: EV (24m) and expected ROI.'));
    if (show('quality')) headerCells.push(th('Quality', 'Compact view: Phonetic, Brandability, SEO, Commercial.'));
    if (show('signals')) headerCells.push(th('Signals', 'Compact view: Dev ecosystem total, GitHub repos, npm packages, archive flag, syllables, length.'));
    if (show('words')) headerCells.push(th('Words', 'Detected meaningful morphemes/word segments in the domain label.'));
    if (show('notes')) headerCells.push(th('Notes', 'Top positive and negative value factors (trimmed).'));
    if (show('realWordPartsScore')) headerCells.push(th('Real Word Parts', 'Real-word decomposition signal.'));
    if (show('cpcKeywordScore')) headerCells.push(th('CPC', 'Commercial CPC keyword signal.'));
    if (show('bestCpcTier')) headerCells.push(th('CPC Tier', 'Best CPC tier hit.'));
    if (show('bestCpcWord')) headerCells.push(th('CPC Word', 'Highest-impact CPC word.'));
    if (show('cvFlowScore')) headerCells.push(th('CV Flow', 'Consonant-vowel flow score.'));
    if (show('keywordMatchScore')) headerCells.push(th('Keyword Match', 'Seed keyword relevance signal.'));
    if (show('devSignalScore')) headerCells.push(th('Dev Signal', 'Developer ecosystem signal score.'));
    if (show('notesPriorityScore')) headerCells.push(th('Notes Priority', 'Composite notes-priority score using selected feature weights.'));

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
          `GH:${row.devEcosystemEvidence && row.devEcosystemEvidence.githubRepos != null ? Number(row.devEcosystemEvidence.githubRepos).toLocaleString() : '-'}`,
          `NPM:${row.devEcosystemEvidence && row.devEcosystemEvidence.npmPackages != null ? Number(row.devEcosystemEvidence.npmPackages).toLocaleString() : '-'}`,
          `Arc:${row.hasArchiveHistory ? 'Y' : 'N'}`,
          `Syl:${Number(row.syllableCount || 0)}`,
          `Len:${Number(row.labelLength || 0)}`,
        ].join(' | ');
        const wordsCell = (row.segmentedWords || []).join(' + ') || '-';
        const notes = [
          row.valueDriversSummary || (row.valueDrivers || []).slice(0, 2).map((x) => `${x.component} (${formatScore(x.impact, 1)})`).join(', '),
          row.valueDetractorsSummary || (row.valueDetractors || []).slice(0, 2).map((x) => `${x.component} (${formatScore(x.impact, 1)})`).join(', '),
        ].filter(Boolean).join(' | ');
        const cells = [];
        if (show('domain')) cells.push(`<td>${escapeHtml(row.domain)} ${flagCell}</td>`);
        if ((includeAvailability || show('availability')) && show('availability')) {
          const isAvail = row.available === true;
          const cls = row.available == null ? '' : (isAvail ? 'good' : 'bad');
          const text = row.available == null ? '-' : (isAvail ? 'Available' : 'Unavailable');
          cells.push(`<td class="${cls}">${text}</td>`);
        }
        if (show('price')) cells.push(`<td>${priceCell}</td>`);
        if (show('estimatedValue')) cells.push(`<td>${estVal}</td>`);
        if (show('valueRatio')) cells.push(`<td class="${row.valueRatio >= 3 ? 'good' : ''}">${vrCell}</td>`);
        if (show('valueMetrics')) cells.push(`<td>${escapeHtml(valueCell)}</td>`);
        if (show('finance')) cells.push(`<td>${escapeHtml(financeCell)}</td>`);
        if (show('quality')) cells.push(`<td>${escapeHtml(qualityCell)}</td>`);
        if (show('signals')) cells.push(`<td>${escapeHtml(signalsCell)}</td>`);
        if (show('words')) cells.push(`<td>${escapeHtml(wordsCell)}</td>`);
        if (show('notes')) cells.push(`<td>${escapeHtml(notes || '-')}</td>`);
        if (show('realWordPartsScore')) cells.push(`<td>${formatScore(row.realWordPartsScore, 1)}</td>`);
        if (show('cpcKeywordScore')) cells.push(`<td>${formatScore(row.cpcKeywordScore, 1)}</td>`);
        if (show('bestCpcTier')) cells.push(`<td>${row.bestCpcTier || '-'}</td>`);
        if (show('bestCpcWord')) cells.push(`<td>${escapeHtml(row.bestCpcWord || '-')}</td>`);
        if (show('cvFlowScore')) cells.push(`<td>${formatScore(row.cvFlowScore, 1)}</td>`);
        if (show('keywordMatchScore')) cells.push(`<td>${formatScore(row.keywordMatchScore, 1)}</td>`);
        if (show('devSignalScore')) cells.push(`<td>${formatScore(row.devSignalScore, 1)}</td>`);
        if (show('notesPriorityScore')) cells.push(`<td>${formatScore(row.notesPriorityScore, 1)}</td>`);
        return `<tr class="${row.underpricedFlag ? 'underpriced-row' : ''}">${cells.join('')}</tr>`;
      })
      .join('');

    return `
      <table>
        <thead><tr>${headerCells.join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function renderLoopSummaryTable(rows, tokenPerfLookup, sectionId) {
    if (!rows || rows.length === 0) {
      return '<p>No loop summaries yet.</p>';
    }
    const sec = sectionId || 'loop-summary-table';
    const show = function (key) { return isColumnVisible(sec, key); };
    return `
      <table>
        <thead>
          <tr>
            ${show('loop') ? th('Loop', 'Loop index within the current search run.') : ''}
            ${show('keywords') ? th('Keywords', 'Keywords used by this loop. Tokens are colored by learned term performance (blue low -> red high).') : ''}
            ${show('strategy') ? th('Strategy', 'Style, randomness, and mutation used in this loop.') : ''}
            ${show('explore') ? th('Explore', 'Exploration rate, elite pool size, curated coverage progress, and strict target coverage (keywords assessed at least target times).') : ''}
            ${show('quota') ? th('Quota', 'Required and in-budget available names for this loop (max names/loop target).') : ''}
            ${show('results') ? th('Results', 'Considered candidates, available split (in-budget/over-budget), and average score for this loop.') : ''}
            ${show('top') ? th('Top', 'Top domain and top score for this loop.') : ''}
            ${show('sourceNote') ? th('Source/Note', 'Name source and any skip note for this loop.') : ''}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const cells = [];
              if (show('loop')) cells.push(`<td>${row.loop}</td>`);
              if (show('keywords')) cells.push(`<td>${renderPerformancePhrase(row.keywords || '-', tokenPerfLookup)}</td>`);
              if (show('strategy')) cells.push(`<td>${escapeHtml(`${row.style || '-'} | ${row.randomness || '-'} | ${row.mutationIntensity || '-'}`)}</td>`);
              if (show('explore')) cells.push(`<td>${escapeHtml(`r=${formatScore(row.explorationRate, 3)} | elite=${Number(row.elitePoolSize || 0)} | cov=${formatScore(Number(row.curatedCoveragePct || 0), 1)}% | target=${formatScore(Number(row.curatedCoverageTargetPct || 0), 1)}%`)}</td>`);
              if (show('quota')) cells.push(`<td>${row.quotaMet ? '<span class="good">' : '<span class="bad">'}${escapeHtml(`${Number(row.requiredQuota || 0)} -> ${Number(row.withinBudgetCount || 0)}`)}</span></td>`);
              if (show('results')) cells.push(`<td>${escapeHtml(`n=${Number(row.consideredCount || 0)} | avail=${Number(row.withinBudgetCount || 0)}/${Number(row.overBudgetCount || 0)} | avg=${formatScore(row.averageOverallScore, 2)}`)}</td>`);
              if (show('top')) cells.push(`<td>${escapeHtml(`${row.topDomain || '-'} | ${formatScore(row.topScore, 1)}`)}</td>`);
              if (show('sourceNote')) cells.push(`<td>${escapeHtml(`${row.nameSource || '-'} | ${row.skipReason || '-'}`)}</td>`);
              return `<tr>${cells.join('')}</tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderTuningTable(rows, tokenPerfLookup, sectionId) {
    if (!rows || rows.length === 0) {
      return '<p>No tuning history yet.</p>';
    }
    const sec = sectionId || 'tuning-table';
    const show = function (key) { return isColumnVisible(sec, key); };

    return `
      <table>
        <thead>
          <tr>
            ${show('loop') ? th('Loop', 'Loop index where this tuning decision was recorded.') : ''}
            ${show('keywords') ? th('Keywords', 'Keyword set chosen for this loop. Tokens are colored by learned performance.') : ''}
            ${show('strategy') ? th('Strategy', 'Source loop and selected style/randomness/mutation.') : ''}
            ${show('explore') ? th('Explore', 'Exploration rate and elite pool at decision time.') : ''}
            ${show('repetitionPenalty') ? th('Rep. penalty', 'Average repetition penalty (0-1) applied to selected keywords for this run; higher = stronger penalty for reusing same keywords across successive loops.') : ''}
            ${show('featureWeights') ? th('Feature Weights', 'Reward prioritization feature weights used for this loop.') : ''}
            ${show('reward') ? th('Reward', 'Composite 0-1 RL reward.') : ''}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => {
              const cells = [];
              const fw = row.featureWeights || {};
              if (show('loop')) cells.push(`<td>${row.loop}</td>`);
              if (show('keywords')) cells.push(`<td>${renderPerformancePhrase(row.keywords || '-', tokenPerfLookup)}</td>`);
              if (show('strategy')) cells.push(`<td>${escapeHtml(`src=${row.sourceLoop == null ? '-' : row.sourceLoop} | ${row.selectedStyle || '-'} | ${row.selectedRandomness || '-'} | ${row.selectedMutationIntensity || '-'}`)}</td>`);
              if (show('explore')) cells.push(`<td>${escapeHtml(`r=${formatScore(row.explorationRate, 3)} | elite=${Number(row.elitePoolSize || 0)}`)}</td>`);
              if (show('repetitionPenalty')) cells.push(`<td>${row.repetitionPenaltyApplied != null ? formatScore(row.repetitionPenaltyApplied, 4) : '-'}</td>`);
              if (show('featureWeights')) cells.push(`<td>${escapeHtml(`rw=${formatScore(Number(fw.realWordParts || 0), 1)} cpc=${formatScore(Number(fw.cpcKeywords || 0), 1)} cv=${formatScore(Number(fw.cvFlow || 0), 1)} km=${formatScore(Number(fw.keywordMatch || 0), 1)} br=${formatScore(Number(fw.brandability || 0), 1)} mem=${formatScore(Number(fw.memorability || 0), 1)} dev=${formatScore(Number(fw.devSignal || 0), 1)}`)}</td>`);
              if (show('reward')) cells.push(`<td>${formatScore(row.reward, 4)}</td>`);
              return `<tr>${cells.join('')}</tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }
  function renderKeywordLibraryTable(keywordLibrary, sectionId) {
    const lib = keywordLibrary || {};
    const rows = Array.isArray(lib.tokens) ? lib.tokens : [];
    const current = Array.isArray(lib.currentKeywords) ? lib.currentKeywords : [];
    const seeds = Array.isArray(lib.seedTokens) ? lib.seedTokens : [];
    const coverage = lib.coverageMetrics || null;
    const dev = lib.devEcosystemStatus || null;
    const sec = sectionId || 'keyword-library-table';
    const show = function (key) { return isColumnVisible(sec, key); };

    if (!rows.length) {
      return '<p>No keyword library metrics yet.</p>';
    }

    const seedBadge = seeds.length ? `<p class="keyword-library-meta"><strong>Seeds:</strong> ${escapeHtml(seeds.join(', '))}</p>` : '';
    const activeBadge = current.length ? `<p class="keyword-library-meta"><strong>Current loop keywords:</strong> ${escapeHtml(current.join(' '))}</p>` : '';
    const coverageBadge = coverage && Number(coverage.total || 0) > 0
      ? `<p class="keyword-library-meta"><strong>Curated coverage:</strong> ${formatScore(Number(coverage.coveragePct || 0), 1)}% | target ${formatScore(Number(coverage.coverageTargetPct || 0), 1)}% (${Number(coverage.assessedTarget || 0)}/${Number(coverage.total || 0)})</p>`
      : '';
    const devBadge = dev
      ? `<p class="keyword-library-meta"><strong>GitHub enrichment:</strong> mode=${escapeHtml(String(dev.mode || 'unknown'))}, words=${escapeHtml(String(dev.attemptedWords || 0))}, github=${escapeHtml(String(dev.githubSuccess || 0))}/${escapeHtml(String(dev.githubCalls || 0))}</p>`
      : '';
    const body = rows.map(function (row) {
      const perf01 = clamp((Number(row.performanceScore) || 0) / 100, 0, 1);
      const wordColor = rainbowColorForScore01(perf01);
      const wordTitle = `Perf ${formatScore(row.performanceScore || 0, 1)} | AvgReward ${formatScore(row.avgReward || 0, 3)} | Success ${formatScore((row.successRate || 0) * 100, 1)}% | Plays ${row.plays || 0} | GitHub ${row.githubRepos == null ? '-' : Number(row.githubRepos).toLocaleString()} | npm ${row.npmPackages == null ? '-' : Number(row.npmPackages).toLocaleString()} | GHPrior ${formatScore(row.githubPrior || 0, 1)}`;
      const cells = [];
      if (show('rank')) cells.push(`<td>${row.rank || '-'}</td>`);
      if (show('word')) cells.push(`<td><span class="perf-token" style="background:${wordColor}" title="${escapeHtml(wordTitle)}">${escapeHtml(row.token || '-')}</span></td>`);
      if (show('state')) cells.push(`<td>${escapeHtml(`${row.source || '-'} | ${row.inCurrentKeywords ? 'active' : 'idle'}`)}</td>`);
      if (show('usage')) cells.push(`<td>${escapeHtml(`plays=${row.plays || 0} | avg=${formatScore(row.avgReward || 0, 4)} | succ=${formatScore((row.successRate || 0) * 100, 1)}% | gh=${row.githubRepos == null ? '-' : Number(row.githubRepos).toLocaleString()} | npm=${row.npmPackages == null ? '-' : Number(row.npmPackages).toLocaleString()}`)}</td>`);
      if (show('evidence')) cells.push(`<td>${escapeHtml(`conf=${formatScore((row.confidence || 0) * 100, 1)}% | dom=${formatScore(row.meanDomainScore || 0, 1)} | perf=${formatScore(row.performanceScore || 0, 1)} | sel=${formatScore(row.selectionScore || 0, 1)} | ghPrior=${formatScore(row.githubPrior || 0, 1)} | ucb=${row.ucb == null ? '-' : formatScore(row.ucb, 4)} | theme=${formatScore(row.themeScore || 0, 2)}`)}</td>`);
      if (show('lastLoop')) cells.push(`<td>${row.lastLoop == null ? '-' : row.lastLoop}</td>`);
      return `<tr${row.inCurrentKeywords ? ' class="keyword-row-active"' : ''}>${cells.join('')}</tr>`;
    }).join('');

    return `
      ${seedBadge}
      ${activeBadge}
      ${coverageBadge}
      ${devBadge}
      <table>
        <thead>
          <tr>
            ${show('rank') ? th('Rank', 'Ranking order in the current curated keyword library view.') : ''}
            ${show('word') ? th('Word', 'Keyword token. Color shows learned performance (blue worst -> red best).') : ''}
            ${show('state') ? th('State', 'Source and whether token is active in current loop keywords.') : ''}
            ${show('usage') ? th('Usage', 'Core usage metrics plus GitHub/npm ecosystem counts for this token.') : ''}
            ${show('evidence') ? th('Evidence', 'Confidence and composite evidence metrics used for RL prioritization, including GitHub prior contribution.') : ''}
            ${show('lastLoop') ? th('Last Loop', 'Most recent loop index where this token was selected.') : ''}
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
        realWordPartsScore: 0,
        cpcKeywordScore: 0,
        bestCpcTier: 0,
        bestCpcWord: '',
        cvFlowScore: 0,
        keywordMatchScore: 0,
        devSignalScore: 0,
        notesPriorityScore: 0,
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
        valueDriversSummary: '',
        valueDetractorsSummary: '',
        _pending: true,
      };
    });
    const combinedRanked = allRanked.concat(pendingRows);
    const filteredCombinedRanked = applyDomainFilters(combinedRanked);
    const filteredWithinBudget = applyDomainFilters(results.withinBudget || []);
    const filteredUnavailable = applyDomainFilters(results.unavailable || []);
    const sortedRanked = sortRows(filteredCombinedRanked, currentSortMode);
    const withinBudget = sortRows(filteredWithinBudget, currentSortMode);
    const unavailable = sortRows(filteredUnavailable, currentSortMode);
    const tokenPerfLookup = buildTokenPerformanceLookup(results.keywordLibrary || null);
    const rankedPage = paginateRows('all-ranked-table', sortedRanked);
    const withinPage = paginateRows('within-budget-table', withinBudget);
    const unavailablePage = paginateRows('unavailable-table', unavailable);
    const loopPage = paginateRows('loop-summary-table', results.loopSummaries || []);
    const tuningPage = paginateRows('tuning-table', results.tuningHistory || []);
    const keywordPage = paginateRows('keyword-library-table', (results.keywordLibrary && results.keywordLibrary.tokens) || []);
    const historyNotice = results.historyTruncated
      ? '<p class="history-notice">Showing recent loop history only. <button type="button" class="btn btn-sm load-history-btn">Load full history</button></p>'
      : '';
    if (results.keywordLibrary && results.keywordLibrary.devEcosystemStatus) {
      dataSourceState.devEcosystem = results.keywordLibrary.devEcosystemStatus;
      renderDataSourcePanel();
    }
    updateDomainFilterStatus(combinedRanked.length, sortedRanked.length);

    renderSummary(results);
    allRankedTableEl.innerHTML = renderDomainTable(rankedPage.rows, false, 'all-ranked-table') + renderPager('all-ranked-table', rankedPage);
    withinBudgetTableEl.innerHTML = renderDomainTable(withinPage.rows, false, 'within-budget-table') + renderPager('within-budget-table', withinPage);
    unavailableTableEl.innerHTML = renderDomainTable(unavailablePage.rows, true, 'unavailable-table') + renderPager('unavailable-table', unavailablePage);

    loopSummaryTableEl.innerHTML = historyNotice + renderLoopSummaryTable(loopPage.rows, tokenPerfLookup, 'loop-summary-table') + renderPager('loop-summary-table', loopPage);
    tuningTableEl.innerHTML = historyNotice + renderTuningTable(tuningPage.rows, tokenPerfLookup, 'tuning-table') + renderPager('tuning-table', tuningPage);
    if (keywordLibraryTableEl) {
      const keywordLib = { ...(results.keywordLibrary || {}), tokens: keywordPage.rows };
      keywordLibraryTableEl.innerHTML = renderKeywordLibraryTable(keywordLib, 'keyword-library-table') + renderPager('keyword-library-table', keywordPage);
    }
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
    const opening = expanded;
    if (opening && currentResults && currentResults.historyTruncated && currentJob && currentJob.id) {
      if (panelId === 'loop-summary-table-panel' || panelId === 'tuning-table-panel') {
        requestRunHistory(currentJob.id).then(function (historyPayload) {
          mergeHistoryIntoCurrent(historyPayload);
        });
      }
    }
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
    const featureWeights = getRewardFeatureWeights();
    return {
      keywords: String(data.get('keywords') || '').trim(),
      description: String(data.get('description') || '').trim(),
      style: String(data.get('style') || 'default'),
      randomness: String(data.get('randomness') || 'medium'),
      mutationIntensity: String(data.get('mutationIntensity') || 'medium'),
      blacklist: String(data.get('blacklist') || '').trim(),
      maxLength: Math.max(1, Math.round(parseNumber(data.get('maxLength'), 10))),
      tld: String(data.get('tld') || 'com').trim(),
      maxNames: Math.max(1, Math.round(parseNumber(data.get('maxNames'), 5))),
      yearlyBudget: Math.max(1, parseNumber(data.get('yearlyBudget'), 50)),
      loopCount: Math.max(1, Math.round(parseNumber(data.get('loopCount'), 100))),
      apiBaseUrl: BACKEND_URL,
      preferEnglish: String(data.get('preferEnglish') || '').toLowerCase() === 'on',
      lowMemoryMode: String(data.get('lowMemoryMode') || '').toLowerCase() === 'on',
      collectUnavailable: String(data.get('collectUnavailable') || '').toLowerCase() === 'on',
      rewardPolicy: (function () {
        const level = String(data.get('repetitionPenaltyLevel') || 'strong').trim();
        const base = persistentRewardPolicy && typeof persistentRewardPolicy === 'object' ? { ...persistentRewardPolicy } : {};
        base.repetitionPenaltyLevel = ['gentle', 'moderate', 'strong', 'very_severe', 'extremely_severe', 'excessive'].includes(level) ? level : 'strong';
        base.featureWeights = featureWeights;
        base.notesBlendWeight = 0.2;
        return base;
      })(),
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
      const incomingVersion = Number(
        job.resultsVersion != null
          ? job.resultsVersion
          : (job.results && job.results.resultsVersion != null ? job.results.resultsVersion : 0)
      );
      currentResults = job.results;
      resultsPanelEl.hidden = false;
      const shouldRender = incomingVersion !== lastRenderedResultsVersion || job.status === 'done' || job.status === 'failed';
      if (job.status === 'done' || job.status === 'failed') {
        if (renderResultsTimeoutId != null) {
          clearTimeout(renderResultsTimeoutId);
          renderResultsTimeoutId = null;
        }
        if (shouldRender) {
          lastRenderedResultsVersion = incomingVersion;
          renderResults(currentResults);
        }
      } else {
        if (shouldRender) {
          if (renderResultsTimeoutId != null) clearTimeout(renderResultsTimeoutId);
          renderResultsTimeoutId = setTimeout(function () {
            renderResultsTimeoutId = null;
            if (currentResults) {
              lastRenderedResultsVersion = incomingVersion;
              renderResults(currentResults);
            }
          }, 220);
        }
      }
    }

    if (job.status === 'done' || job.status === 'failed') {
      destroyEngine();
      latestRunExport = {
        run: cloneForExport(job),
        results: cloneForExport(job.results || currentResults || {}),
      };
      downloadJsonBtn.disabled = !latestRunExport || !latestRunExport.run || !latestRunExport.results;
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      if (job.id && job.results && job.results.historyTruncated) {
        requestRunHistory(job.id).then(function (historyPayload) {
          mergeHistoryIntoCurrent(historyPayload);
          latestRunExport = {
            run: cloneForExport(job),
            results: cloneForExport(currentResults || job.results || {}),
          };
          downloadJsonBtn.disabled = !latestRunExport || !latestRunExport.run || !latestRunExport.results;
        });
      }
      if (job.status === 'done') {
        void ingestCompletedRun(job, currentInput);
      }
    }
  }

  async function downloadResultsJson() {
    if (!latestRunExport || !latestRunExport.run || !latestRunExport.results) {
      return;
    }
    if (currentResults && currentResults.historyTruncated && currentJob && currentJob.id) {
      const historyPayload = await requestRunHistory(currentJob.id);
      mergeHistoryIntoCurrent(historyPayload);
      latestRunExport = {
        run: cloneForExport(latestRunExport.run),
        results: cloneForExport(currentResults || latestRunExport.results),
      };
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

  var SECTION_CSV_FILENAMES = {
    'all-ranked-table': 'domainname_wizard_all_ranked.csv',
    'within-budget-table': 'domainname_wizard_within_budget.csv',
    'unavailable-table': 'domainname_wizard_unavailable.csv',
    'loop-summary-table': 'domainname_wizard_loop_summaries.csv',
    'keyword-library-table': 'domainname_wizard_keyword_library.csv',
    'tuning-table': 'domainname_wizard_tuning_history.csv',
  };

  function downloadCsvBlob(csv, filename) {
    if (!csv) return false;
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'domainname_wizard_export.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  }

  function copyTextFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = Boolean(document.execCommand && document.execCommand('copy'));
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function copyTextRobust(text) {
    if (!text) return false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    return copyTextFallback(text);
  }

  async function copySectionCsv(sectionId) {
    if (!currentResults) {
      showJobError('No results available yet for CSV export.');
      return;
    }
    var csv = getSectionCsv(sectionId, currentResults, currentSortMode);
    if (!csv || csv.length < 2) {
      showJobError('No CSV rows available for this section.');
      return;
    }
    var copied = await copyTextRobust(csv);
    if (!copied) {
      downloadCsvBlob(csv, SECTION_CSV_FILENAMES[sectionId] || 'domainname_wizard_section.csv');
      showJobError('Clipboard is unavailable in this browser context. Downloaded CSV instead.');
      return;
    }
    showJobError('');
  }

  function downloadSectionCsv(sectionId) {
    if (!currentResults) {
      showJobError('No results available yet for CSV export.');
      return;
    }
    var csv = getSectionCsv(sectionId, currentResults, currentSortMode);
    if (!csv || csv.length < 2) {
      showJobError('No CSV rows available for this section.');
      return;
    }
    var filename = SECTION_CSV_FILENAMES[sectionId] || 'domainname_wizard_section.csv';
    downloadCsvBlob(csv, filename);
    showJobError('');
  }

  async function copyFullCsv() {
    if (!currentResults) {
      showJobError('No results available yet for CSV export.');
      return;
    }
    var csv = getFullCsv(currentResults, currentSortMode);
    if (!csv) {
      showJobError('No CSV rows available for full export.');
      return;
    }
    var copied = await copyTextRobust(csv);
    if (!copied) {
      var nowForCopy = new Date();
      var dateStrForCopy = nowForCopy.getFullYear() + '-' + String(nowForCopy.getMonth() + 1).padStart(2, '0') + '-' + String(nowForCopy.getDate()).padStart(2, '0') + '_' + String(nowForCopy.getHours()).padStart(2, '0') + '-' + String(nowForCopy.getMinutes()).padStart(2, '0');
      var fallbackName = 'domainname_wizard_full_' + dateStrForCopy + '.csv';
      if (currentJob && currentJob.id) fallbackName = 'domainname_wizard_full_' + String(currentJob.id) + '_' + dateStrForCopy + '.csv';
      downloadCsvBlob(csv, fallbackName);
      showJobError('Clipboard is unavailable in this browser context. Downloaded CSV instead.');
      return;
    }
    showJobError('');
  }

  function downloadFullCsv() {
    if (!currentResults) {
      showJobError('No results available yet for CSV export.');
      return;
    }
    var csv = getFullCsv(currentResults, currentSortMode);
    if (!csv) {
      showJobError('No CSV rows available for full export.');
      return;
    }
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '_' + String(now.getHours()).padStart(2, '0') + '-' + String(now.getMinutes()).padStart(2, '0');
    var filename = 'domainname_wizard_full_' + dateStr + '.csv';
    if (currentJob && currentJob.id) filename = 'domainname_wizard_full_' + String(currentJob.id) + '_' + dateStr + '.csv';
    downloadCsvBlob(csv, filename);
    showJobError('');
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
    currentInput = input;
    currentDebugLogsMax = input.lowMemoryMode ? DEBUG_LOGS_MAX_LOW_MEMORY : DEBUG_LOGS_MAX_DEFAULT;
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
    lastRenderedResultsVersion = -1;
    latestRunExport = null;
    Object.keys(tablePageState).forEach(function (k) { tablePageState[k] = 1; });
    downloadJsonBtn.disabled = true;

    destroyEngine();
    const activeEngine = ensureEngine();
    activeEngine.postMessage({ type: 'start', input: input });
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    statusLabelEl.textContent = 'Queued';
    progressLabelEl.textContent = '(0%)';
    loopLabelEl.textContent = 'Loop -/-';
    elapsedLabelEl.textContent = 'Elapsed: 00:00';
    progressFillEl.style.width = '0%';
  }

  let engine = null;
  let historyReqCounter = 0;
  const historyReqResolvers = new Map();

  function mergeHistoryRows(existingRows, incomingRows) {
    const byLoop = new Map();
    (existingRows || []).forEach(function (row) { byLoop.set(Number(row.loop || 0), row); });
    (incomingRows || []).forEach(function (row) { byLoop.set(Number(row.loop || 0), row); });
    return Array.from(byLoop.values()).sort(function (a, b) { return (Number(a.loop) || 0) - (Number(b.loop) || 0); });
  }

  function mergeHistoryIntoCurrent(historyPayload) {
    if (!currentResults || !historyPayload) return;
    const loopRows = Array.isArray(historyPayload.loopSummaries) ? historyPayload.loopSummaries : [];
    const tuningRows = Array.isArray(historyPayload.tuningHistory) ? historyPayload.tuningHistory : [];
    currentResults.loopSummaries = mergeHistoryRows(currentResults.loopSummaries || [], loopRows);
    currentResults.tuningHistory = mergeHistoryRows(currentResults.tuningHistory || [], tuningRows);
    currentResults.historyTruncated = false;
    currentResults.historyWindowStartLoop = 1;
    renderResults(currentResults);
  }

  function bindEngine(worker) {
    if (!worker || !worker.addEventListener) return;
    worker.addEventListener('message', function (event) {
      const message = event.data || {};

      if (message.type === 'debugLog' && message.payload) {
        debugLogs.push(message.payload);
        if (debugLogs.length > currentDebugLogsMax) {
          debugLogs.splice(0, debugLogs.length - currentDebugLogsMax);
        }
        updateDataSourcePanel(message.payload);
        return;
      }

      if (message.type === 'history') {
        const reqId = message.requestId || null;
        if (reqId && historyReqResolvers.has(reqId)) {
          const resolve = historyReqResolvers.get(reqId);
          historyReqResolvers.delete(reqId);
          resolve(message);
        }
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

    worker.addEventListener('error', function (event) {
      const errorMessage = event.message || 'Worker runtime error.';
      pushDebugLog('app.js:workerErrorEvent', 'Worker runtime error', { message: errorMessage });
      showFormError(errorMessage);
      startBtn.disabled = false;
      cancelBtn.disabled = true;
    });
  }

  function ensureEngine() {
    if (engine) return engine;
    engine = createEngineBridge();
    bindEngine(engine);
    return engine;
  }

  function destroyEngine() {
    if (engine && typeof engine.terminate === 'function') {
      engine.terminate();
    }
    engine = null;
  }

  function requestRunHistory(jobId) {
    const activeEngine = ensureEngine();
    const requestId = `hist-${Date.now()}-${++historyReqCounter}`;
    return new Promise(function (resolve) {
      historyReqResolvers.set(requestId, resolve);
      activeEngine.postMessage({ type: 'getHistory', jobId: jobId, requestId: requestId });
      setTimeout(function () {
        if (!historyReqResolvers.has(requestId)) return;
        const done = historyReqResolvers.get(requestId);
        historyReqResolvers.delete(requestId);
        done({ loopSummaries: [], tuningHistory: [] });
      }, 10000);
    });
  }

  startBtn.addEventListener('click', function () {
    Promise.allSettled([
      runPreflightDiagnostics('before-start'),
      loadPersistentRunProfile('before-start'),
    ]).finally(function () {
      handleStart();
    });
  });

  cancelBtn.addEventListener('click', function () {
    if (!currentJob || !currentJob.id) {
      return;
    }
    const activeEngine = ensureEngine();
    activeEngine.postMessage({ type: 'cancel', jobId: currentJob.id });
  });

  sortModeEl.addEventListener('change', function () {
    currentSortMode = sortModeEl.value || 'marketability';
    resetDomainTablePages();
    if (currentResults) {
      renderResults(currentResults);
    }
  });

  function onDomainFilterInputChange() {
    if (renderResultsTimeoutId != null) {
      clearTimeout(renderResultsTimeoutId);
      renderResultsTimeoutId = null;
    }
    resetDomainTablePages();
    if (currentResults) renderResults(currentResults);
    else updateDomainFilterStatus(0, 0);
  }

  if (domainFilterIncludeEl) domainFilterIncludeEl.addEventListener('input', onDomainFilterInputChange);
  if (domainFilterExcludeEl) domainFilterExcludeEl.addEventListener('input', onDomainFilterInputChange);
  if (clearDomainFiltersBtn) {
    clearDomainFiltersBtn.addEventListener('click', function () {
      if (domainFilterIncludeEl) domainFilterIncludeEl.value = '';
      if (domainFilterExcludeEl) domainFilterExcludeEl.value = '';
      onDomainFilterInputChange();
    });
  }

  downloadJsonBtn.addEventListener('click', function () {
    void downloadResultsJson();
  });

  if (resultsPanelEl) {
    resultsPanelEl.addEventListener('click', function (e) {
    var pagerBtn = e.target && e.target.closest && e.target.closest('.pager-btn');
    if (pagerBtn && pagerBtn.dataset.sectionId && pagerBtn.dataset.pageAction) {
      var sid = pagerBtn.dataset.sectionId;
      var cur = Number(tablePageState[sid] || 1);
      tablePageState[sid] = pagerBtn.dataset.pageAction === 'prev' ? Math.max(1, cur - 1) : (cur + 1);
      if (currentResults) renderResults(currentResults);
      return;
    }
    var historyBtn = e.target && e.target.closest && e.target.closest('.load-history-btn');
    if (historyBtn && currentJob && currentJob.id) {
      requestRunHistory(currentJob.id).then(function (historyPayload) {
        mergeHistoryIntoCurrent(historyPayload);
      });
      return;
    }
    var columnBtn = e.target && e.target.closest && e.target.closest('.column-section-btn');
    if (columnBtn && columnBtn.dataset.sectionId) {
      openColumnPicker(columnBtn.dataset.sectionId);
      return;
    }
    var btn = e.target && e.target.closest && e.target.closest('.csv-section-btn');
    if (!btn || !btn.dataset.sectionId) return;
    var sectionId = btn.dataset.sectionId;
    if (btn.dataset.action === 'copy') copySectionCsv(sectionId);
    else if (btn.dataset.action === 'download') downloadSectionCsv(sectionId);
    });
  }

  var copyFullCsvBtn = document.getElementById('copy-full-csv-btn');
  var downloadFullCsvBtn = document.getElementById('download-full-csv-btn');
  if (copyFullCsvBtn) copyFullCsvBtn.addEventListener('click', copyFullCsv);
  if (downloadFullCsvBtn) downloadFullCsvBtn.addEventListener('click', downloadFullCsv);

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

  if (rewardPresetEl) {
    rewardPresetEl.addEventListener('change', function () {
      applyRewardPreset(rewardPresetEl.value || 'balanced');
    });
  }
  Object.values(rewardSliderEls).forEach(function (slider) {
    if (!slider) return;
    slider.addEventListener('input', updateRewardValueBadges);
  });
  applyRewardPreset((rewardPresetEl && rewardPresetEl.value) || 'balanced');
  sectionColumnState = loadColumnPrefs();

  initTableSections();
  setSessionDefaultKeywords();
  runPreflightDiagnostics('initial-load');
  void loadPersistentRunProfile('initial-load');

})();
