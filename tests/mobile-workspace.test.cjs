const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function workspace({ mobile = true, hash = '', scrollY = 0, type = 'navigate' } = {}) {
    const window = new EventTarget(), frames = [], snaps = [];
    const fields = { 'depth-chart-card': { scrollIntoView: options => snaps.push(options) },
        'range-settings': { open: false }, 'fee-settings': { open: false } };
    const links = ['range-settings', 'fee-settings'].map(id => Object.assign(new EventTarget(), { hash: `#${id}` }));
    Object.assign(window, { matchMedia: () => ({ matches: mobile }), scrollY });
    const location = { hash };
    const document = { getElementById: id => fields[id], querySelectorAll: () => links,
        addEventListener: (name, callback) => callback() };
    vm.runInNewContext(fs.readFileSync('main.mobile-workspace.js', 'utf8'), {
        document, window, location, performance: { getEntriesByType: () => [{ type }] },
        requestAnimationFrame: callback => frames.push(callback)
    });
    const flushFrames = () => { while (frames.length) frames.shift()(); };
    return { window, fields, links, snaps, location, flushFrames, load() {
        window.dispatchEvent(new Event('load'));
        flushFrames();
    } };
}

test('fresh mobile visits land at the graph, desktop visits keep their layout', () => {
    const phone = workspace(); phone.load(); assert.equal(phone.snaps.length, 1);
    const desktop = workspace({ mobile: false }); desktop.load(); assert.equal(desktop.snaps.length, 0);
});

test('initial graph landing respects deep links, restored position, history and early interaction', () => {
    for (const options of [{ hash: '#config-column' }, { hash: '#data-tables-card' }, { scrollY: 100 }, { type: 'back_forward' }]) {
        const h = workspace(options); h.load(); assert.equal(h.snaps.length, 0);
    }
    const h = workspace(); h.window.dispatchEvent(new Event('pointerdown')); h.load();
    assert.equal(h.snaps.length, 0);
});

test('quick settings and direct links reveal disclosures, and finished setup returns to graph', () => {
    const h = workspace({ hash: '#range-settings' });
    assert.equal(h.fields['range-settings'].open, true);
    h.links[1].dispatchEvent(new Event('click'));
    assert.equal(h.fields['fee-settings'].open, true);
    h.fields['fee-settings'].open = false;
    h.location.hash = '#fee-settings'; h.window.dispatchEvent(new Event('hashchange'));
    assert.equal(h.fields['fee-settings'].open, true);
    h.window.dispatchEvent(new Event('orderskew:plan-ready'));
    assert.equal(h.snaps.length, 0, 'wait until modal focus has been restored');
    h.flushFrames();
    assert.equal(h.snaps.length, 1);
});
