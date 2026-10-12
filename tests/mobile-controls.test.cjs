const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = require('./calculator-harness.cjs');

function mobileHarness() {
    const h = harness({}, 'buy-only');
    const captures = new Map();
    class Element extends EventTarget {
        constructor() { super(); this.value = ''; this.attributes = {}; this.children = []; }
        append(...children) { this.children.push(...children); }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name] || null; }
        focus() {}
        setPointerCapture(id) { captures.set(id, this); }
    }
    const ids = {};
    const fields = { startCap: 'starting_capital', currPrice: 'current_price', currPriceSell: 'current_price_sell',
        existQty: 'existing_quantity', rungsInput: 'number_of_rungs_input', depthInput: 'depth_input',
        skew: 'skew_value', priceRangeMode: 'price_range_mode', buyFloor: 'buy_floor', sellCeiling: 'sell_ceiling' };
    Object.entries(fields).forEach(([key, id]) => {
        const source = Object.assign(new Element(), h.els[key]);
        if (key === 'rungsInput') source.max = '50';
        if (key === 'depthInput') source.max = '99';
        ids[id] = source;
        h.els[key] = source;
        source.addEventListener('input', () => h.App.calculatePlan());
    });
    ['mobile-controls', 'mobile-controls-fields', 'mobile-controls-skew', 'mobile-controls-status'].forEach(id => { ids[id] = new Element(); });
    const doc = Object.assign(new EventTarget(), { activeElement: null, getElementById: id => ids[id], createElement: () => new Element() });
    doc.addEventListener = (event, callback) => event === 'DOMContentLoaded' ? callback()
        : EventTarget.prototype.addEventListener.call(doc, event, callback);
    h.context.window = Object.assign(new EventTarget(), h.context.window);
    const timers = new Map();
    let timerId = 0;
    h.context.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
    h.context.clearTimeout = id => timers.delete(id);
    h.context.document = doc;
    h.context.Event = Event;
    h.context.App = h.App;
    h.context.window.App = h.App;
    h.calculate();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'main.mobile-controls.js'), 'utf8'), h.context);
    const controls = Object.fromEntries([...ids['mobile-controls-fields'].children, ...ids['mobile-controls-skew'].children].map(label => {
        const group = label.children[1];
        const input = group.children.length ? group.children[1] : group;
        return [input.id.replace('mobile-control-', ''), { label, input, buttons: group.children }];
    }));
    return { ...h, ids, doc, controls, timers, captures, release(pointerId, type = 'pointerup') {
        const owner = captures.get(pointerId);
        (owner || doc).dispatchEvent(Object.assign(new Event(type), { pointerId }));
        captures.delete(pointerId);
        owner?.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId }));
    }, tick(expectedDelay) {
        const [id, { callback, delay }] = timers.entries().next().value;
        if (expectedDelay !== undefined) assert.equal(delay, expectedDelay);
        timers.delete(id);
        callback();
    }, edit(name, value) {
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

test('step buttons update live orders, capital and price while respecting range and order limits', () => {
    const h = mobileHarness();
    const click = (name, direction) => h.controls[name].buttons[direction > 0 ? 2 : 0].dispatchEvent(new Event('click'));
    click('orders', 1);
    assert.equal(h.State.currentPlanData.buyLadder.length, 11);
    click('amount', 1);
    assert.equal(h.els.startCap.value, '50100');
    click('price', -1);
    assert.equal(h.els.currPrice.value, '99');
    h.edit('orders', '50');
    click('orders', 1);
    assert.equal(h.State.currentPlanData.buyLadder.length, 50);
    h.edit('orders', '2');
    click('orders', -1);
    assert.equal(h.State.currentPlanData.buyLadder.length, 2);
    h.edit('range', '99');
    click('range', 1);
    assert.equal(h.els.depthInput.value, '99');
    h.edit('range', '0.1');
    click('range', -1);
    assert.equal(h.els.depthInput.value, '0.1');
});

test('price stepping preserves small positive asset prices', () => {
    const h = mobileHarness();
    h.edit('price', '0.00001');
    h.controls.price.buttons[0].dispatchEvent(new Event('click'));
    assert.equal(h.els.currPrice.value, '0.0000099');
    assert.ok(h.State.currentPlanData.buyLadder.every(row => row.price > 0));
});

test('holding a step button repeats live changes, stops on release and does not double-count its click', () => {
    const h = mobileHarness();
    const button = h.controls.orders.buttons[2];
    const down = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0, pointerId: 1 });
    button.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.equal(h.State.currentPlanData.buyLadder.length, 11);
    assert.equal(h.captures.get(1), button);
    h.tick(350);
    h.tick(100);
    assert.equal(h.State.currentPlanData.buyLadder.length, 13);
    h.release(1);
    assert.equal(h.timers.size, 0);
    button.dispatchEvent(Object.assign(new Event('click'), { detail: 1 }));
    assert.equal(h.State.currentPlanData.buyLadder.length, 13);
    button.dispatchEvent(Object.assign(new Event('click'), { detail: 0 }));
    assert.equal(h.State.currentPlanData.buyLadder.length, 14);
});

test('cancelled pointers and window blur stop held steps, and repeat respects order limits', () => {
    const h = mobileHarness();
    const button = h.controls.orders.buttons[0];
    const hold = () => button.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerId: 1 }));
    h.edit('orders', '3');
    hold();
    assert.equal(h.timers.size, 0);
    assert.equal(h.State.currentPlanData.buyLadder.length, 2);
    h.release(1, 'pointercancel');
    assert.equal(h.timers.size, 0);
    h.edit('orders', '10');
    hold();
    h.context.window.dispatchEvent(new Event('blur'));
    assert.equal(h.timers.size, 0);
});

test('unrelated pointers cannot interrupt a hold and keyboard clicks do not add a release step', () => {
    const h = mobileHarness();
    const button = h.controls.orders.buttons[2];
    const pointer = (type, pointerId) => button.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId }));
    pointer('pointerdown', 1);
    pointer('pointerdown', 2);
    pointer('pointerup', 2);
    h.tick(350);
    assert.equal(h.els.rungsInput.value, '12');
    button.dispatchEvent(Object.assign(new Event('click'), { detail: 0 }));
    assert.equal(h.els.rungsInput.value, '13');
    h.release(1);
    button.dispatchEvent(Object.assign(new Event('click'), { detail: 1 }));
    assert.equal(h.els.rungsInput.value, '13');
    assert.equal(h.timers.size, 0);
});

test('held steps stop at both bounds without dispatching redundant input updates', () => {
    const h = mobileHarness();
    let updates = 0;
    h.els.rungsInput.addEventListener('input', () => updates++);
    for (const [start, index, bound] of [['49', 2, '50'], ['3', 0, '2']]) {
        h.edit('orders', start);
        updates = 0;
        const button = h.controls.orders.buttons[index];
        button.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerId: 1 }));
        assert.equal(h.els.rungsInput.value, bound);
        assert.equal(updates, 1);
        assert.equal(h.timers.size, 0);
        h.release(1);
        button.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerId: 1 }));
        assert.equal(updates, 1);
        assert.equal(h.timers.size, 0);
        h.release(1);
    }
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
