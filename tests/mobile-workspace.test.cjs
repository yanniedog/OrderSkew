const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function workspace({ mobile = true, hash = '', scrollY = 0, type = 'navigate' } = {}) {
    const window = new EventTarget(), frames = [], snaps = [];
    const columns = ['config-column', 'graph-column'];
    const results = ['chart-summary-overlay', 'depth-chart-card', 'data-tables-card'];
    const fields = { 'depth-chart-card': { scrollIntoView: options => snaps.push(options) },
        'range-settings': { open: false }, 'fee-settings': { open: false } };
    const links = ['range-settings', 'fee-settings'].map(id => Object.assign(new EventTarget(), { hash: `#${id}` }));
    const media = Object.assign(new EventTarget(), { matches: mobile });
    Object.assign(window, { matchMedia: () => media, scrollY });
    const location = { hash };
    const document = { getElementById: id => fields[id], querySelectorAll: () => links,
        addEventListener: (name, callback) => callback() };
    document.activeElement = { focus: () => { document.activeElement = focused; } };
    const focused = document.activeElement;
    for (const group of [columns, results]) {
        for (const id of [...group]) {
            fields[id] ||= {};
            for (const [method, offset] of [['before', 0], ['after', 1]]) fields[id][method] = node => {
                group.splice(group.indexOf(node.id), 1);
                group.splice(group.indexOf(id) + offset, 0, node.id);
                document.activeElement = null; // Moving a focused subtree can blur it.
            };
            fields[id].id = id;
        }
    }
    vm.runInNewContext(fs.readFileSync('main.mobile-workspace.js', 'utf8'), {
        document, window, location, performance: { getEntriesByType: () => [{ type }] },
        requestAnimationFrame: callback => frames.push(callback)
    });
    const flushFrames = () => { while (frames.length) frames.shift()(); };
    return { window, fields, links, snaps, location, flushFrames, columns, results, media, document, focused, load() {
        window.dispatchEvent(new Event('load'));
        flushFrames();
    } };
}

test('fresh mobile visits land at the graph, desktop visits keep their layout', () => {
    const phone = workspace(); phone.load(); assert.equal(phone.snaps.length, 1);
    const desktop = workspace({ mobile: false }); desktop.load(); assert.equal(desktop.snaps.length, 0);
});

test('reading and focus order follow the graph-first layout and restore on desktop resize', () => {
    const h = workspace();
    assert.deepEqual(h.columns, ['graph-column', 'config-column']);
    assert.deepEqual(h.results, ['depth-chart-card', 'chart-summary-overlay', 'data-tables-card']);
    assert.equal(h.document.activeElement, h.focused);
    h.media.matches = false; h.media.dispatchEvent(new Event('change'));
    assert.deepEqual(h.columns, ['config-column', 'graph-column']);
    assert.deepEqual(h.results, ['chart-summary-overlay', 'depth-chart-card', 'data-tables-card']);
    assert.equal(h.document.activeElement, h.focused);
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
