const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateAssetResponse } = require('../scripts/validate-asset-response.cjs');

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
