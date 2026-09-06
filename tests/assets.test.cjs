const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { versionAssets, writeAssets } = require('../scripts/update-calculator-assets.cjs');

test('changed calculator content gets a new URL without changing external resources', () => {
    const html = '<link href="styles.css" rel="stylesheet"><script src="app.js"></script><script src="https://example.com/lib.js"></script>';
    const initial = versionAssets(html, file => file).html;
    const changed = versionAssets(initial, file => file === 'app.js' ? 'new app code' : file).html;
    assert.notEqual(changed, initial);
    assert.equal(initial.match(/styles\.[a-f0-9]+\.css/)[0], changed.match(/styles\.[a-f0-9]+\.css/)[0]);
    assert.ok(changed.includes('src="https://example.com/lib.js"'));
    assert.match(changed, /src="calculator-assets\/app\.[a-f0-9]{12}\.js"/);
    assert.equal(versionAssets(changed, file => file === 'app.js' ? 'new app code' : file).html, changed);
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
    assert.match(result.html, /SRC = "calculator-assets\/app\.[a-f0-9]{12}\.js"/);
    assert.match(result.html, /href = 'calculator-assets\/styles\.[a-f0-9]{12}\.css'/);
});

test('every calculator dependency has an immutable content filename', () => {
    const root = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8').replace(/\r\n/g, '\n');
    const assets = [...html.matchAll(/(?:src|href)="((?:calculator-assets\/)?[\w.-]+\.(?:js|css))(?:\?[^"\s]*)?"/g)];
    assert.ok(assets.length > 0);
    for (const [, file] of assets) {
        assert.match(file, /^calculator-assets\/[\w.-]+\.[a-f0-9]{12}\.(?:js|css)$/);
    }
    assert.ok(headers.includes('/calculator-assets/*\n  Cache-Control: public, max-age=31536000, immutable\n'));
});

test('asset generation rejects missing or tampered files and only cleans managed filenames', () => {
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'orderskew-assets-'));
    try {
        const old = versionAssets('<script src="app.js?v=old"></script>', () => 'old').assets;
        assert.equal(writeAssets(root, old, true), false);
        writeAssets(root, old, false);
        assert.equal(writeAssets(root, old, true), true);
        const oldFile = path.join(root, Object.keys(old)[0]);
        fs.writeFileSync(oldFile, 'tampered');
        assert.equal(writeAssets(root, old, true), false);
        fs.writeFileSync(path.join(root, 'calculator-assets', 'notes.txt'), 'preserve');
        const next = versionAssets('<script src="app.js"></script>', () => 'new').assets;
        writeAssets(root, next, false);
        assert.equal(fs.existsSync(oldFile), false);
        assert.equal(writeAssets(root, next, true), true);
        assert.equal(fs.readFileSync(path.join(root, 'calculator-assets', 'notes.txt'), 'utf8'), 'preserve');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
