const test = require('node:test');
const assert = require('node:assert/strict');
const mobileHarness = require('./mobile-controls-harness.cjs');

test('parameter changes pulse once, while repeated selection and calculator updates stay silent', () => {
    const h = mobileHarness(), pulses = [];
    h.context.navigator = { vibrate: duration => pulses.push(duration) };
    h.App.calculatePlan();
    h.select('amount');
    assert.deepEqual(pulses, []);
    h.scroll('range');
    h.scroll('range');
    h.App.calculatePlan();
    assert.deepEqual(pulses, [8]);
    h.select('orders');
    assert.deepEqual(pulses, [8, 8]);
    h.context.navigator.vibrate = () => { throw Error('Blocked'); };
    assert.doesNotThrow(() => h.select('price'));
    assert.equal(h.slider.getAttribute('aria-label'), 'Price');
});

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

test('fixed bounds can recover through the slider after a large reference-price change', () => {
    const h = mobileHarness();
    h.els.currPrice.value = '0.00001';
    h.els.priceRangeMode.value = 'floor';
    h.App.calculatePlan();
    assert.equal(h.State.currentPlanData, null);
    h.select('low');
    assert.ok(Number(h.slider.min) < Number(h.slider.max) && Number(h.slider.max) < 0.00001);
    h.click(-1);
    assert.ok(h.State.currentPlanData);
    h.State.tradingMode = 'sell-only';
    h.els.currPriceSell.value = '10000';
    h.App.calculatePlan();
    h.select('high');
    h.click(1);
    assert.ok(Number(h.els.sellCeiling.value) > 10000);
    assert.ok(h.State.currentPlanData);
});
