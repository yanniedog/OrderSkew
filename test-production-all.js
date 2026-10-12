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
  '/apps/web/index.html', '/tools/novel_indicator/frontend/package.json', '/pages/domainname_wizard/app.js',
  '/pages/nab_homeloan_calculator/index.html', '/pages/novel_indicator/index.html', '/pages/domainname_wizard/index.html',
  '/pages/crypto_ath_drawdown_cycles/index.html', '/pages/boardspace_atlas/index.html'];
const retiredApi = [
  ['GET', '/api/health'], ['GET', '/api/version'],
  ['GET', '/api/crypto-ath/coingecko'], ['GET', '/api/crypto-ath/binance'],
  ['POST', '/api/domains/availability'], ['POST', '/api/names/generate'], ['POST', '/api/dev-ecosystem'],
  ['POST', '/api/runs/ingest'], ['GET', '/api/runs/profile'],
  ['POST', '/api/searches'], ['GET', '/api/searches/retirement-probe'],
  ['POST', '/api/auth/register'], ['POST', '/api/auth/login'], ['POST', '/api/auth/logout'],
  ['POST', '/api/auth/email/verify/request'], ['POST', '/api/auth/email/verify/confirm'],
  ['POST', '/api/auth/password/forgot'], ['POST', '/api/auth/password/reset'],
  ['GET', '/api/auth/google/start'], ['GET', '/api/auth/google/callback'], ['GET', '/api/auth/session'],
  ['GET', '/api/me'], ['GET', '/api/me/preferences'], ['PUT', '/api/me/preferences'],
  ['GET', '/api/me/runs'], ['POST', '/api/me/runs'],
  ['GET', '/api/me/runs/retirement-probe'], ['DELETE', '/api/me/runs/retirement-probe'],
  ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].flatMap(method =>
    ['/api/home-loan-rates', '/api/home-loan-rates/latest', '/api/nonexistent'].map(route => [method, route]))
];
for (const route of new Set(retiredApi.map(([, route]) => route))) {
  if (!retiredApi.some(([method, path]) => method === 'OPTIONS' && path === route)) retiredApi.push(['OPTIONS', route]);
}

async function request(url, redirect = 'follow', method = 'GET') {
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined;
  const response = await fetch(url, { redirect, method, body,
    headers: body ? { 'Content-Type': 'application/json' } : undefined, signal: AbortSignal.timeout(20000) });
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

async function checkAssets(origin) {
  for (const asset of expected) {
    const url = `${origin}/${asset}`;
    const response = await request(url);
    assert.equal(response.status, 200, asset);
    assert.equal(validateAssetResponse(url, response.headers, response.body), null, asset);
    const local = fs.readFileSync(path.join(__dirname, asset.split('?')[0]), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(response.body.replace(/\r\n/g, '\n'), local, `${asset}: deployed bytes differ`);
  }
  console.log(`PASS: ${origin} ${expected.length} deployed calculator assets, MIME types, content hashes and checkout parity`);
}

async function checkRetired(origin) {
  for (const route of retired) {
    const response = await request(origin + route, 'manual');
    assert.ok([404, 410].includes(response.status), `${origin}${route}: expected retired route 404/410, got ${response.status}`);
  }
  console.log(`PASS: ${origin} all ${retired.length} former tool, hub, shared asset and API routes retired`);
  for (const [method, route] of retiredApi) {
    const response = await request(origin + route, 'manual', method);
    assert.ok([404, 410].includes(response.status), `${origin}${route} ${method}: expected retired API 404/410, got ${response.status}`);
  }
  console.log(`PASS: ${origin} all ${retiredApi.length} retired API method/path checks`);
}

async function main() {
  const production = ['www.orderskew.com', 'orderskew.com'].includes(new URL(base).hostname);
  const origins = production ? ['https://www.orderskew.com', 'https://orderskew.com'] : [base];
  for (const origin of origins) {
    await checkCalculator(origin);
    await checkAssets(origin);
    await checkRetired(origin);
  }
  console.log('All calculator production and tool retirement checks passed. No checks skipped.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
