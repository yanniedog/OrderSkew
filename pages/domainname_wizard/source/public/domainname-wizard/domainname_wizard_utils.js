// Domain Name Wizard - pure format/phase helpers (loaded before app.js)
(function () {
  function backendUrl() {
    if (typeof window === 'undefined' || !window.location) return '';
    var protocol = (window.location.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    var origin = window.location.origin;
    if (origin) return origin;
    var host = window.location.host;
    if (host) return protocol + '//' + host;
    return '';
  }
  window.DomainNameWizardUtils = {
    BACKEND_URL: backendUrl(),
    escapeHtml: function (input) {
      var div = document.createElement('div');
      div.textContent = input == null ? '' : String(input);
      return div.innerHTML;
    },
    clamp: function (value, min, max) {
      return Math.min(max, Math.max(min, value));
    },
    parseNumber: function (value, fallback) {
      var parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    formatMoney: function (value, currency) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '-';
      }
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
      }).format(value);
    },
    formatScore: function (value, digits) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '-';
      }
      return value.toFixed(digits == null ? 1 : digits);
    },
    formatElapsed: function (ms) {
      if (!Number.isFinite(ms) || ms < 0) {
        return '00:00';
      }
      var seconds = Math.floor(ms / 1000);
      var hours = Math.floor(seconds / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      var remSeconds = seconds % 60;
      if (hours > 0) {
        return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(remSeconds).padStart(2, '0');
      }
      return String(minutes).padStart(2, '0') + ':' + String(remSeconds).padStart(2, '0');
    },
    phaseLabel: function (status, phase) {
      if (status === 'queued') return 'Queued';
      if (status === 'running' && phase === 'looping') return 'Iterative tuning';
      if (status === 'running' && phase === 'namelix') return 'Generating names via Namelix';
      if (status === 'running' && phase === 'godaddy') return 'Checking availability (GoDaddy or RDAP)';
      if (status === 'running' && phase === 'rdap') return 'Checking availability (RDAP)…';
      if (status === 'running' && phase === 'finalize') return 'Finalizing';
      if (status === 'done') return 'Done';
      if (status === 'failed') return 'Failed';
      return status || 'Idle';
    },
  };
})();
