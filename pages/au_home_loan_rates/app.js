(function () {
    function normalizeApiBase(input) {
        if (!input) return '';
        return String(input).replace(/\/+$/, '');
    }

    function currency(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return n.toFixed(3) + '%';
    }

    var params = new URLSearchParams(window.location.search);
    var apiOverride = params.get('apiBase');
    var apiBase = normalizeApiBase(apiOverride) || (window.location.origin + '/api/home-loan-rates');

    var els = {
        apiBaseText: document.getElementById('api-base-text'),
        refreshAll: document.getElementById('refresh-all'),
        refreshHealth: document.getElementById('refresh-health'),
        refreshLatest: document.getElementById('refresh-latest'),
        refreshRuns: document.getElementById('refresh-runs'),
        healthOutput: document.getElementById('health-output'),
        latestBody: document.getElementById('latest-body'),
        runsOutput: document.getElementById('runs-output'),
        adminToken: document.getElementById('admin-token')
    };

    if (els.apiBaseText) {
        els.apiBaseText.textContent = apiBase;
    }

    async function fetchJson(url, options) {
        var response = await fetch(url, options || {});
        var text = await response.text();
        var data = null;
        try {
            data = JSON.parse(text);
        } catch (err) {
            data = { ok: false, raw: text };
        }
        return { response: response, data: data };
    }

    async function loadHealth() {
        if (!els.healthOutput) return;
        els.healthOutput.textContent = 'Loading health...';
        try {
            var result = await fetchJson(apiBase + '/health');
            els.healthOutput.textContent = JSON.stringify(result.data, null, 2);
        } catch (err) {
            els.healthOutput.textContent = JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2);
        }
    }

    function renderLatestRows(rows) {
        if (!els.latestBody) return;
        if (!Array.isArray(rows) || rows.length === 0) {
            els.latestBody.innerHTML = '<tr><td colspan="6">No normalized rate rows yet.</td></tr>';
            return;
        }

        els.latestBody.innerHTML = rows.map(function (row) {
            return '<tr>' +
                '<td>' + String(row.bank_name || '-') + '</td>' +
                '<td>' + String(row.product_name || row.product_id || '-') + '</td>' +
                '<td>' + String(row.lvr_tier || '-') + '</td>' +
                '<td>' + String(row.rate_structure || '-') + '</td>' +
                '<td>' + currency(row.interest_rate) + '</td>' +
                '<td>' + String(row.collection_date || '-') + '</td>' +
                '</tr>';
        }).join('');
    }

    async function loadLatest() {
        if (!els.latestBody) return;
        els.latestBody.innerHTML = '<tr><td colspan="6">Loading latest rates...</td></tr>';
        try {
            var result = await fetchJson(apiBase + '/latest?limit=20');
            if (!result.response.ok) {
                els.latestBody.innerHTML = '<tr><td colspan="6">Failed to load latest (' + result.response.status + ').</td></tr>';
                return;
            }
            renderLatestRows(result.data && result.data.rows || []);
        } catch (err) {
            els.latestBody.innerHTML = '<tr><td colspan="6">Error loading latest: ' + String(err && err.message || err) + '</td></tr>';
        }
    }

    async function loadRuns() {
        if (!els.runsOutput) return;
        els.runsOutput.textContent = 'Loading runs...';

        var token = els.adminToken && els.adminToken.value ? String(els.adminToken.value).trim() : '';
        var headers = {};
        if (token) headers.Authorization = 'Bearer ' + token;

        try {
            var result = await fetchJson(apiBase + '/admin/runs?limit=10', { headers: headers });
            if (!result.response.ok) {
                els.runsOutput.textContent = JSON.stringify({
                    ok: false,
                    status: result.response.status,
                    message: token ? 'Admin request failed.' : 'Admin token required for run status.',
                    body: result.data
                }, null, 2);
                return;
            }
            els.runsOutput.textContent = JSON.stringify(result.data, null, 2);
        } catch (err) {
            els.runsOutput.textContent = JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2);
        }
    }

    async function refreshAll() {
        await Promise.all([loadHealth(), loadLatest(), loadRuns()]);
    }

    if (els.refreshAll) els.refreshAll.addEventListener('click', refreshAll);
    if (els.refreshHealth) els.refreshHealth.addEventListener('click', loadHealth);
    if (els.refreshLatest) els.refreshLatest.addEventListener('click', loadLatest);
    if (els.refreshRuns) els.refreshRuns.addEventListener('click', loadRuns);

    refreshAll();
})();