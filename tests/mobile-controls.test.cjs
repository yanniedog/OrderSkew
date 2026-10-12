const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = require('./calculator-harness.cjs');

function mobileHarness() {
    const h = harness({}, 'buy-only');
    class Element extends EventTarget {
        constructor() { super(); this.value = ''; this.attributes = {}; this.children = []; }
        append(...children) { this.children.push(...children); }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name] || null; }
    }
    const ids = {};
    const fields = { startCap: 'starting_capital', currPrice: 'current_price', currPriceSell: 'current_price_sell',
        existQty: 'existing_quantity', rungsInput: 'number_of_rungs_input', depthInput: 'depth_input',
        skew: 'skew_value', priceRangeMode: 'price_range_mode', buyFloor: 'buy_floor', sellCeiling: 'sell_ceiling' };
    Object.entries(fields).forEach(([key, id]) => {
        const source = Object.assign(new Element(), h.els[key]);
        ids[id] = source;
        h.els[key] = source;
        source.addEventListener('input', () => h.App.calculatePlan());
    });
    ['mobile-controls', 'mobile-controls-fields', 'mobile-controls-status'].forEach(id => { ids[id] = new Element(); });
    const doc = { activeElement: null, getElementById: id => ids[id], createElement: () => new Element(),
        addEventListener: (event, callback) => callback() };
    h.context.document = doc;
    h.context.Event = Event;
    h.context.App = h.App;
    h.context.window.App = h.App;
    h.calculate();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'main.mobile-controls.js'), 'utf8'), h.context);
    const controls = Object.fromEntries(ids['mobile-controls-fields'].children.map(label => {
        const input = label.children[1];
        return [input.id.replace('mobile-control-', ''), { label, input }];
    }));
    return { ...h, ids, doc, controls, edit(name, value) {
        const input = controls[name].input;
        doc.activeElement = input;
        input.value = value;
        input.dispatchEvent(new Event('input'));
    } };
}

test('mobile edits recalculate the shared plan and empty edits clear stale outputs', () => {
    const h = mobileHarness();
    h.edit('orders', '6');
    assert.equal(h.els.rungsInput.value, '6');
    assert.equal(h.State.currentPlanData.buyLadder.length, 6);
    h.edit('range', '30');
    assert.equal(h.els.depthInput.value, '30');
    h.edit('amount', '10000');
    assert.ok(Math.abs(h.State.currentPlanData.buyLadder.reduce((sum, row) => sum + row.capital, 0) - 10000) < 1e-8);
    h.edit('orders', '');
    assert.equal(h.State.currentPlanData, null);
    assert.equal(h.controls.orders.input.value, '');
    assert.equal(h.ids['mobile-controls-status'].textContent, 'Check inputs');
});

test('mobile controls follow sell-only holdings and fixed bounds without editing hidden buy settings', () => {
    const h = mobileHarness();
    h.State.tradingMode = 'sell-only';
    h.els.priceRangeMode.value = 'floor';
    h.App.calculatePlan();
    assert.equal(h.controls.range.label.hidden, true);
    assert.equal(h.controls.low.label.hidden, true);
    assert.equal(h.controls.high.label.hidden, false);
    h.edit('amount', '25');
    assert.equal(h.els.existQty.value, '25');
    assert.equal(h.els.startCap.value, '50000');
    h.edit('high', '150');
    assert.ok(h.State.currentPlanData.sellLadder.every(row => row.price > 100 && row.price < 150));
    assert.ok(Math.abs(h.State.currentPlanData.sellLadder.reduce((sum, row) => sum + row.assetSize, 0) - 25) < 1e-8);
});

test('full-form updates refresh mobile values and validation', () => {
    const h = mobileHarness();
    h.els.startCap.value = '12,345';
    h.els.rungsInput.setAttribute('aria-invalid', 'true');
    h.App.calculatePlan();
    assert.equal(h.controls.amount.input.value, '12345');
    assert.equal(h.controls.orders.input.getAttribute('aria-invalid'), 'true');
});
