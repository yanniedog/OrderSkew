'use strict';

// Check the public hub only; do not visit the individual tools.
const assert = require('node:assert/strict');
const baseUrls = process.argv.slice(2);
if (!baseUrls.length) baseUrls.push('https://www.orderskew.com', 'https://orderskew.com');
const expectedPaths = [
  '/pages/nab_homeloan_calculator/index.html',
  '/pages/novel_indicator/index.html',
  '/pages/domainname_wizard/index.html',
  '/pages/crypto_ath_drawdown_cycles/index.html',
  '/pages/boardspace_atlas/index.html'
].sort();

async function verify(baseUrl) {
  for (const path of ['/tools', '/tools/', '/pages/', '/pages/index.html']) {
    const requestedUrl = new URL(path, baseUrl);
    const response = await fetch(requestedUrl, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, `${requestedUrl}: HTTP ${response.status}`);
    const html = await response.text();
    assert.match(html, /<h1>Other tools<\/h1>/i, `${requestedUrl}: missing tools hub`);
    assert.match(html, /<base href="\/pages\/">/, `${requestedUrl}: missing tool asset base`);
    assert.match(new URL(response.url).pathname, /^\/tools\/?$/, `${requestedUrl}: wrong destination`);
    const cardLinks = [...html.matchAll(/class="card-link" href="([^"]+)"/g)];
    assert.equal(cardLinks.length, 5, `${requestedUrl}: missing launch links`);
    const actualPaths = cardLinks.map(([, href]) => {
      const target = new URL(href, new URL('/pages/', response.url));
      assert.equal(target.origin, new URL(response.url).origin);
      return target.pathname;
    }).sort();
    assert.deepEqual(actualPaths, expectedPaths, `${requestedUrl}: incorrect launch destinations`);
    console.log(`PASS ${requestedUrl} -> ${response.url}: hub and five launch links`);
  }
}

(async () => {
  for (const baseUrl of baseUrls) await verify(baseUrl);
})().catch(error => {
  console.error(error.message, error.cause?.message || '');
  process.exitCode = 1;
});
