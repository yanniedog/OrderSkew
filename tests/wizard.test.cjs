const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = require('./calculator-harness.cjs');

function setup(answers) {
    const h = harness();
    for (const field of Object.values(h.els)) {
        let value = field.value;
        Object.defineProperty(field, 'value', { get: () => value, set: next => { value = String(next); } });
        field.dispatchEvent = () => {};
    }
    h.els.depthDisplayLabel = { textContent: '20' };
    h.context.Event = class { constructor(type) { this.type = type; } };
    h.context.document = { getElementById: id => ({ depth_input: h.els.depthInput, depth: h.els.depth })[id] };
    h.App.setTradingMode = mode => { h.State.tradingMode = mode; };
    h.context.window.App = h.App;
    h.context.window.OrderSkewEls = h.els;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../wizard.js'), 'utf8'), h.context);
    h.context.window.SetupWizard.answers = answers;
    h.context.window.SetupWizard.applyAnswers();
    return h;
}

test('combined wizard applies its percentage to controls, range label and both ladders', () => {
    const h = setup({ trading_mode: 'buy-sell', starting_capital: 1000, current_price: 200,
        range_percent: 37, depth: 20, target_price: 75 });
    const plan = h.calculate();
    assert.equal(h.els.depthInput.value, '37');
    assert.equal(h.els.depth.value, '37');
    assert.equal(String(h.els.depthDisplayLabel.textContent), '37');
    assert.equal(h.els.priceRangeMode.value, 'width');
    assert.equal(h.els.currPriceSell.value, '200');
    assert.equal(plan.buyLadder.length, 8);
    assert.equal(plan.sellLadder.length, 8);
    assert.equal(plan.buyLadder[0].price, 195.375);
    assert.equal(plan.sellLadder[0].price, 204.625);
});

for (const [mode, target] of [['buy-only', 100], ['sell-only', 300]]) {
    test(`${mode} wizard applies its explicit bound and reference price`, () => {
        const h = setup({ trading_mode: mode, starting_capital: 1000, existing_quantity: 10,
            current_price: 200, depth: 50, target_price: target });
        const plan = h.calculate();
        assert.equal(h.els.priceRangeMode.value, 'floor');
        assert.equal(h.els.currPriceSell.value, '200');
        assert.equal(h.els[mode === 'buy-only' ? 'buyFloor' : 'sellCeiling'].value, String(target));
        assert.equal(plan.buyLadder.length, mode === 'buy-only' ? 8 : 0);
        assert.equal(plan.sellLadder.length, mode === 'sell-only' ? 8 : 0);
    });
}
