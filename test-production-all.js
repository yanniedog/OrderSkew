// Calculator-only production verification; retired tools must return a real 404/410.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { extractCalculatorAssets, validateAssetSet, validateAssetResponse } = require('./scripts/validate-asset-response.cjs');
const base = (process.argv[2] || process.env.BASE_URL || 'https://www.orderskew.com').replace(/\/$/, '');
const expected = extractCalculatorAssets(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
const retired = ['/tools', '/tools/', '/tools/index.html', '/pages', '/pages/', '/pages/index.html',
  '/pages/nab_homeloan_calculator/', '/pages/novel_indicator/', '/pages/domainname_wizard/',
  '/pages/crypto_ath_drawdown_cycles/', '/pages/boardspace_atlas/', '/page-frame.js',
  '/api/crypto-ath/coingecko', '/api/crypto-ath/binance', '/api/domains/availability', '/api/names/generate',
  '/api/runs/ingest', '/api/runs/profile', '/api/dev-ecosystem', '/api/health', '/api/version', '/api/nonexistent',
  '/apps/web/index.html', '/tools/novel_indicator/frontend/package.json', '/pages/domainname_wizard/app.js',
  '/pages/nab_homeloan_calculator/index.html', '/pages/novel_indicator/index.html', '/pages/domainname_wizard/index.html',
  '/pages/crypto_ath_drawdown_cycles/index.html', '/pages/boardspace_atlas/index.html', '/api/home-loan-rates/latest'];

async function request(url, redirect = 'follow') {
  const response = await fetch(url, { redirect, signal: AbortSignal.timeout(20000) });
  return { status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) };
}

async function checkCalculator(origin) {
  const response = await request(origin + '/');
  assert.equal(response.status, 200, `${origin}: calculator must be available`);
  assert.match(response.body, /Build your trading plan/);
  assert.doesNotMatch(response.body, /(?:href|src)=["']\/?(?:tools|pages)\//i);
  assert.equal(validateAssetSet(expected, extractCalculatorAssets(response.body)), null);
  console.log(`PASS: ${origin} calculator availability, navigation and current asset references`);
}

async function checkAssets() {
  for (const asset of expected) {
    const url = `${base}/${asset}`;
    const response = await request(url);
    assert.equal(response.status, 200, asset);
    assert.equal(validateAssetResponse(url, response.headers, response.body), null, asset);
    const local = fs.readFileSync(path.join(__dirname, asset.split('?')[0]), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(response.body.replace(/\r\n/g, '\n'), local, `${asset}: deployed bytes differ`);
  }
  console.log(`PASS: ${expected.length} deployed calculator assets, MIME types, content hashes and checkout parity`);
}

async function checkRetired(origin) {
  for (const route of retired) {
    const response = await request(origin + route, 'manual');
    assert.ok([404, 410].includes(response.status), `${origin}${route}: expected retired route 404/410, got ${response.status}`);
  }
  console.log(`PASS: ${origin} all ${retired.length} former tool, hub, shared asset and API routes retired`);
}

async function main() {
  const production = ['www.orderskew.com', 'orderskew.com'].includes(new URL(base).hostname);
  const origins = production ? ['https://www.orderskew.com', 'https://orderskew.com'] : [base];
  for (const origin of origins) await checkCalculator(origin);
  await checkAssets();
  for (const origin of origins) await checkRetired(origin);
  console.log('All calculator production and tool retirement checks passed. No checks skipped.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
