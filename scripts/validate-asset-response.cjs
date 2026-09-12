const { createHash } = require('node:crypto');

function validateAssetResponse(url, headers, body) {
    const pathname = new URL(url).pathname;
    const extension = pathname.match(/\.(js|css)$/)?.[1];
    if (!extension) return null;
    const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const allowed = extension === 'css' ? ['text/css'] : ['text/javascript', 'application/javascript', 'application/x-javascript'];
    if (!allowed.includes(type)) return `unexpected ${extension} content type: ${type || '(missing)'}`;
    if (/^\s*(?:<!doctype html|<html\b)/i.test(body)) return 'HTML fallback returned as an asset';
    const expected = pathname.match(/\.([a-f0-9]{12})\.(?:js|css)$/)?.[1];
    if (expected) {
        const actual = createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
        if (actual !== expected) return `content hash mismatch: expected ${expected}, received ${actual}`;
    }
    return null;
}

function extractCalculatorAssets(html) {
    return [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["'](calculator-assets\/[\w.-]+\.(?:js|css)(?:\?[^"'\s]*)?)["']/gi)]
        .map(match => match[1].replace(/&amp;/g, '&'));
}

function validateAssetSet(expected, actual) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    if (!expectedSet.size || expectedSet.size !== actualSet.size || [...expectedSet].some(asset => !actualSet.has(asset))) {
        return 'deployed calculator asset references differ from the current checkout';
    }
    return null;
}

module.exports = { validateAssetResponse, extractCalculatorAssets, validateAssetSet };
