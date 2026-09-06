const test = require('node:test');
const assert = require('node:assert/strict');
const { versionAssets } = require('../scripts/update-calculator-assets.cjs');

test('changed calculator content gets a new URL without changing external resources', () => {
    const html = '<link href="styles.css" rel="stylesheet"><script src="app.js"></script><script src="https://example.com/lib.js"></script>';
    const initial = versionAssets(html, file => file).html;
    const changed = versionAssets(initial, file => file === 'app.js' ? 'new app code' : file).html;
    assert.notEqual(changed, initial);
    assert.equal(initial.match(/styles.css\?v=\w+/)[0], changed.match(/styles.css\?v=\w+/)[0]);
    assert.ok(changed.includes('src="https://example.com/lib.js"'));
    assert.match(changed, /src="app.js\?v=[a-f0-9]{12}"/);
});

test('asset versions are stable across Windows/Linux checkout line endings and repeated updates', () => {
    const html = '<script src="app.js"></script>';
    const linux = versionAssets(html, () => 'a\nb\n').html;
    assert.equal(versionAssets(html, () => 'a\r\nb\r\n').html, linux);
    assert.equal(versionAssets(linux, () => 'a\nb\n').html, linux);
});

test('valid HTML attribute spacing and capitalization cannot skip versioning', () => {
    const result = versionAssets('<SCRIPT SRC = "app.js"></SCRIPT><link href = \'styles.css\'>', file => file);
    assert.equal(result.count, 2);
    assert.match(result.html, /SRC = "app.js\?v=[a-f0-9]{12}"/);
    assert.match(result.html, /href = 'styles.css\?v=[a-f0-9]{12}'/);
});
