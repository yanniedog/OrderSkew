const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateAssetResponse, extractCalculatorAssets, validateAssetSet } = require('../scripts/validate-asset-response.cjs');

test('rejects successful HTML fallbacks at stylesheet and script URLs', () => {
    for (const extension of ['css', 'js']) {
        const url = `https://example.com/calculator-assets/app.123456789abc.${extension}`;
        assert.match(validateAssetResponse(url, {'content-type':'text/html'}, '<!doctype html>'), /content type/);
        const type = extension === 'css' ? 'text/css' : 'text/javascript';
        assert.match(validateAssetResponse(url, {'content-type':type}, '<!doctype html>'), /HTML fallback/);
    }
});

test('verifies immutable body hashes and accepts CRLF-normalized content', () => {
    const body = 'body { color: red; }\n';
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
    const url = `https://example.com/calculator-assets/styles.${hash}.css`;
    assert.equal(validateAssetResponse(url, {'content-type':'text/css; charset=utf-8'}, body.replace(/\n/g, '\r\n')), null);
    assert.match(validateAssetResponse(url, {'content-type':'text/css'}, body + '/* stale */'), /hash mismatch/);
});

test('query-bearing deployed references retain their complete request URL', () => {
    const html = `<SCRIPT SRC = "calculator-assets/app.123456789abc.js?mode=x&amp;flag=1"></SCRIPT><link href='calculator-assets/style.abcdef123456.css'>`;
    assert.deepEqual(extractCalculatorAssets(html), ['calculator-assets/app.123456789abc.js?mode=x&flag=1', 'calculator-assets/style.abcdef123456.css']);
});

test('an internally valid old deployment cannot satisfy checkout asset parity', () => {
    const expected = ['calculator-assets/app.123456789abc.js?mode=x', 'calculator-assets/style.abcdef123456.css'];
    assert.equal(validateAssetSet(expected, [...expected].reverse()), null);
    assert.match(validateAssetSet(expected, [expected[0].replace('123456789abc', '999999999999'), expected[1]]), /differ/);
    assert.match(validateAssetSet(expected, [expected[0].split('?')[0], expected[1]]), /differ/);
    assert.match(validateAssetSet(expected, []), /differ/);
});
