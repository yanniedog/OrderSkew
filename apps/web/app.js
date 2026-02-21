(function () {
  var output = document.getElementById('output');
  var refresh = document.getElementById('refresh');

  async function loadHealth() {
    if (!output) return;
    output.textContent = 'Loading...';
    try {
      var response = await fetch('/api/health');
      var text = await response.text();
      var data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, raw: text };
      }
      output.textContent = JSON.stringify({ status: response.status, data: data }, null, 2);
    } catch (err) {
      output.textContent = JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2);
    }
  }

  if (refresh) refresh.addEventListener('click', loadHealth);
  loadHealth();
})();