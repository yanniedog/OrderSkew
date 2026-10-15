const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = require('./calculator-harness.cjs');

function fakeClock(context) {
    const timers = new Map();
    let timerId = 0;
    context.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
    context.clearTimeout = id => timers.delete(id);
    return { timers, tick(expectedDelay) {
        const [id, { callback, delay }] = timers.entries().next().value;
        if (expectedDelay !== undefined) assert.equal(delay, expectedDelay);
        timers.delete(id);
        callback();
    } };
}

function wireSources(h, Element) {
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
    return ids;
}

function mobileHarness() {
    const h = harness({}, 'buy-only');
    const captures = new Map();
    class Element extends EventTarget {
        constructor() { super(); this.value = ''; this.attributes = {}; this.children = []; this.scrollTop = 0; this.clientHeight = 88; }
        append(child) { this.children.push(child); child.parent = this; }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name] || null; }
        focus() {}
        setPointerCapture(id) { captures.set(id, this); }
        getClientRects() { return [{}]; }
        getBoundingClientRect() {
            const index = this.parent?.children.filter(child => !child.hidden).indexOf(this) || 0;
            return { top: this.parent ? 22 + index * 44 - this.parent.scrollTop : 0, height: this.parent ? 44 : 88 };
        }
        scrollIntoView() {
            if (!this.parent) return;
            this.parent.scrollTop = this.parent.children.filter(child => !child.hidden).indexOf(this) * 44;
            this.parent.dispatchEvent(new Event('scroll'));
        }
    }
    const ids = wireSources(h, Element);
    ['mobile-controls', 'mobile-parameter-picker', 'mobile-control-slider', 'mobile-controls-status',
        'mobile-slider-panel', 'mobile-control-value', 'mobile-step-down', 'mobile-step-up'].forEach(id => { ids[id] = new Element(); });
    const doc = { getElementById: id => ids[id], createElement: () => new Element(), addEventListener: (event, cb) => { if (event === 'DOMContentLoaded') cb(); } };
    h.context.window = Object.assign(new EventTarget(), h.context.window);
    const clock = fakeClock(h.context);
    Object.assign(h.context, { document: doc, Event, App: h.App });
    h.context.window.App = h.App;
    h.calculate();
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'main.mobile-controls.js'), 'utf8'), h.context);
    const picker = ids['mobile-parameter-picker'], slider = ids['mobile-control-slider'];
    const buttons = Object.fromEntries(picker.children.map(button => [button.id.replace('mobile-parameter-', ''), button]));
    return { ...h, ...clock, ids, slider, picker, buttons, captures,
        select(name) { buttons[name].dispatchEvent(new Event('click')); },
        scroll(name) { picker.scrollTop = picker.children.filter(button => !button.hidden).indexOf(buttons[name]) * 44; picker.dispatchEvent(new Event('scroll')); },
        slide(value) { slider.value = String(value); slider.dispatchEvent(new Event('input')); },
        click(direction) { ids[direction > 0 ? 'mobile-step-up' : 'mobile-step-down'].dispatchEvent(Object.assign(new Event('click'), { detail: 0 })); },
        release(pointerId) { captures.get(pointerId)?.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId })); }
    };
}

test('one shared slider switches parameters without altering the plan, then updates live results', () => {
    const h = mobileHarness(), plan = h.State.currentPlanData;
    assert.equal(h.slider.getAttribute('aria-label'), 'Capital');
    h.select('orders');
    assert.equal(h.State.currentPlanData, plan);
    assert.equal(h.slider.getAttribute('aria-label'), 'Orders');
    assert.equal(h.buttons.orders.getAttribute('aria-selected'), 'true');
    assert.equal(h.buttons.amount.getAttribute('aria-selected'), 'false');
    h.slide(6);
    assert.equal(h.els.rungsInput.value, '6');
    assert.equal(h.State.currentPlanData.buyLadder.length, 6);
    h.select('amount');
    h.slide(10000);
    assert.ok(Math.abs(h.State.currentPlanData.buyLadder.reduce((sum, row) => sum + row.capital, 0) - 10000) < 1e-8);
});

test('vertical scrolling and arrow keys select the centered parameter for the same horizontal slider', () => {
    const h = mobileHarness();
    h.scroll('range');
    assert.equal(h.slider.getAttribute('aria-label'), 'Range');
    h.slide(30);
    assert.equal(h.els.depthInput.value, '30');
    h.picker.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowDown' }));
    assert.equal(h.slider.getAttribute('aria-label'), 'Skew');
    h.slide(75);
    assert.equal(h.els.skew.value, '75');
    h.picker.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Home' }));
    assert.equal(h.slider.getAttribute('aria-label'), 'Capital');
});

test('shared fine-step buttons retain timing, pointer capture, bounds and keyboard behavior', () => {
    const h = mobileHarness();
    h.select('orders');
    const button = h.ids['mobile-step-up'];
    const down = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0, pointerId: 1 });
    button.dispatchEvent(down);
    assert.ok(down.defaultPrevented);
    assert.equal(h.captures.get(1), button);
    h.tick(350); h.tick(100);
    assert.equal(h.els.rungsInput.value, '13');
    h.click(1);
    h.release(1);
    button.dispatchEvent(Object.assign(new Event('click'), { detail: 1 }));
    assert.equal(h.els.rungsInput.value, '14');
    assert.equal(h.timers.size, 0);
    h.slide(50);
    h.click(1);
    assert.equal(h.els.rungsInput.value, '50');
});

test('changing the wheel selection or mode cancels a held step before it can change another parameter', () => {
    const h = mobileHarness();
    h.select('orders');
    h.ids['mobile-step-up'].dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerId: 1 }));
    h.select('price');
    assert.equal(h.timers.size, 0);
    assert.equal(h.els.currPrice.value, '100');
    h.select('amount');
    h.ids['mobile-step-up'].dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerId: 2 }));
    h.State.tradingMode = 'sell-only';
    h.App.calculatePlan();
    assert.equal(h.timers.size, 0);
    assert.equal(h.els.existQty.value, '10');
});

test('mode-aware picker exposes fixed bounds and switches sell controls to holdings', () => {
    const h = mobileHarness();
    h.select('range');
    h.State.tradingMode = 'sell-only';
    h.els.priceRangeMode.value = 'floor';
    h.App.calculatePlan();
    assert.ok(h.buttons.range.hidden);
    assert.ok(h.buttons.low.hidden);
    assert.equal(h.buttons.high.hidden, false);
    assert.equal(h.slider.getAttribute('aria-label'), 'Quantity');
    h.slide(15);
    assert.equal(h.els.existQty.value, '15');
    assert.equal(h.els.startCap.value, '50000');
    h.select('high');
    assert.ok(Number(h.slider.min) > 100);
    h.slide(150);
    assert.ok(h.State.currentPlanData.sellLadder.every(row => row.price > 100 && row.price < 150));
});

test('external form changes and invalid entries stay authoritative and refresh the shared slider', () => {
    const h = mobileHarness();
    h.els.startCap.value = '12,345';
    h.App.calculatePlan();
    assert.equal(h.slider.value, '12345');
    h.els.startCap.value = '';
    h.App.calculatePlan();
    assert.equal(h.State.currentPlanData, null);
    assert.equal(h.els.startCap.value, '');
    assert.equal(h.ids['mobile-control-value'].textContent, 'Check input');
    assert.equal(h.ids['mobile-controls-status'].textContent, 'Check inputs');
});

test('tiny prices keep precision and fixed-bound limits follow reference-price changes', () => {
    const h = mobileHarness();
    h.els.currPrice.value = '0.00001';
    h.App.calculatePlan();
    h.select('price'); h.click(-1);
    assert.equal(h.els.currPrice.value, '0.0000099');
    h.els.currPrice.value = '100';
    h.els.priceRangeMode.value = 'floor';
    h.App.calculatePlan();
    h.select('low');
    assert.ok(Number(h.slider.max) < 100);
    h.els.currPrice.value = '90';
    h.App.calculatePlan();
    assert.ok(Number(h.slider.max) < 90);
});

test('unrelated pointers cannot cancel a hold, while pointer cancellation and blur stop it', () => {
    const h = mobileHarness(), button = h.ids['mobile-step-up'];
    h.select('orders');
    const pointer = (type, pointerId) => button.dispatchEvent(Object.assign(new Event(type), { pointerId, button: 0 }));
    pointer('pointerdown', 1); pointer('pointerdown', 2); pointer('pointerup', 2);
    h.tick(350);
    assert.equal(h.els.rungsInput.value, '12');
    pointer('pointercancel', 1);
    assert.equal(h.timers.size, 0);
    pointer('pointerdown', 3);
    h.context.window.dispatchEvent(new Event('blur'));
    assert.equal(h.timers.size, 0);
    pointer('pointerdown', 4);
    h.ids['mobile-controls'].open = false;
    h.ids['mobile-controls'].dispatchEvent(new Event('toggle'));
    assert.equal(h.timers.size, 0);
});

test('capital and price fine steps can expand beyond the initial slider scale', () => {
    const h = mobileHarness();
    h.slide(100000);
    h.click(1);
    assert.equal(h.els.startCap.value, '101000');
    assert.ok(Number(h.slider.max) > 101000);
    h.select('price'); h.slide(200); h.click(1);
    assert.equal(h.els.currPrice.value, '201');
});

test('zero holdings use the quote-price scale and can start with a fractional quantity', () => {
    const h = mobileHarness();
    h.State.tradingMode = 'sell-only';
    h.els.existQty.value = '0';
    h.els.currPriceSell.value = '10000';
    h.App.calculatePlan();
    assert.equal(h.slider.getAttribute('aria-label'), 'Quantity');
    assert.equal(Number(h.slider.step), 0.0001);
    h.click(1);
    assert.equal(h.els.existQty.value, '0.0001');
    assert.ok(h.State.currentPlanData);
    h.slide(0.005);
    assert.equal(h.els.existQty.value, '0.005');
    assert.ok(Math.abs(h.State.currentPlanData.sellLadder.reduce((sum, row) => sum + row.assetSize, 0) - 0.005) < 1e-8);
});

test('blank fixed-price bounds derive usable precision from a sub-dollar reference price', () => {
    const h = mobileHarness();
    h.els.currPrice.value = '0.00001';
    h.els.buyFloor.value = '';
    h.els.priceRangeMode.value = 'floor';
    h.App.calculatePlan();
    h.select('low');
    assert.equal(Number(h.slider.step), 0.0000001);
    assert.ok(Number(h.slider.min) < Number(h.slider.max));
    h.click(1);
    assert.ok(Number(h.els.buyFloor.value) > 0 && Number(h.els.buyFloor.value) < 0.00001);
    assert.ok(h.State.currentPlanData);
    h.State.tradingMode = 'sell-only';
    h.els.currPriceSell.value = '0.00001';
    h.els.sellCeiling.value = '';
    h.App.calculatePlan();
    h.select('high');
    assert.equal(Number(h.slider.step), 0.0000001);
    assert.ok(Number(h.slider.min) > 0.00001 && Number(h.slider.min) < Number(h.slider.max));
    h.click(1);
    assert.ok(h.State.currentPlanData);
});

test('zero quantity refreshes its scale immediately after an external reference-price edit', () => {
    const h = mobileHarness();
    h.State.tradingMode = 'sell-only';
    h.els.existQty.value = '0';
    h.App.calculatePlan();
    assert.equal(Number(h.slider.step), 0.01);
    h.els.currPriceSell.value = '10000';
    h.App.calculatePlan();
    assert.equal(Number(h.slider.step), 0.0001);
    assert.equal(Number(h.slider.max), 0.02);
    h.els.currPriceSell.value = '10,000';
    h.ids['mobile-step-up'].dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerId: 1 }));
    assert.equal(h.els.existQty.value, '0.0001');
    assert.equal(h.timers.size, 1);
    h.release(1);
    assert.equal(h.timers.size, 0);
});
