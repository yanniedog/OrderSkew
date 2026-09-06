const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./calculator-harness.cjs');
function setup(fields, mode) {
    const h = harness(fields, mode);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.config.js'), 'utf8'), h.context);
    return { ...h, Config: h.context.window.OrderSkewConfig };
}
for (const mode of ['buy-only', 'sell-only', 'buy-sell']) test(`complete config roundtrip: ${mode}`, () => {
    const h = setup({ currPrice: '0.0000123', existQty: 12345, existAvg: '', feeType: 'fixed',
        feeValue: 0.0001, feeSettlement: 'external', spacingMode: 'relative', priceRangeMode: 'floor',
        buyFloor: '0.000009', sellCeiling: '0.00005', rungsInput: 17, depthInput: 42 }, mode);
    const config = h.Config.capture(h.els);
    assert.equal(JSON.stringify(h.Config.parse(JSON.stringify(config))), JSON.stringify(config));
    assert.equal(config.tradingMode, mode);
    assert.equal(config.currentPrice, '0.0000123');
    assert.equal(config.existingAvgPrice, '');
});
for (const bad of ['null', '[]', '{}', '{"version":99}', '{', '{"startingCapital":{},"numberOfRungs":10,"skewValue":50,"depth":20}']) {
    test(`reject malformed settings: ${bad}`, () => assert.throws(() => setup().Config.parse(bad)));
}
test('legacy files retain their four fields and are recognizable as partial', () => {
    const config = setup().Config.parse(JSON.stringify({ startingCapital: '1234', numberOfRungs: 10, skewValue: 50, depth: 20 }));
    assert.equal(config.version, undefined);
    assert.equal(Object.keys(config).length, 4);
});

test('a fixed-range plan can restore an unused blank percentage field', () => {
    const h = setup({ priceRangeMode: 'floor', depthInput: '' });
    assert.ok(h.calculate());
    const config = h.Config.capture(h.els);
    assert.equal(h.Config.parse(JSON.stringify(config)).depth, '');
});
test('CSV exports only active sides and includes settings, summary and fees', () => {
    const h = setup({}, 'buy-only');
    const csv = h.Config.csv(h.calculate(), h.Config.capture(h.els));
    assert.equal((csv.match(/^"Buy",/gm) || []).length, 10);
    assert.equal((csv.match(/^"Sell",/gm) || []).length, 0);
    assert.ok(csv.includes('"Fee"'));
    assert.ok(csv.includes('"currentPrice","100"'));
    assert.ok(csv.includes('"netProfit",""'));
});
test('tiny prices display and copy without becoming zero', () => {
    const { Utils } = setup();
    assert.equal(Number(Utils.formatForCopy(1e-10)), 1e-10);
    assert.equal(Number(Utils.fmtNumDisplay(1e-10)), 1e-10);
    assert.equal(Utils.sanitizeInput('1e-10'), '1e-10');
    assert.equal(Utils.formatNumberWithCommas('1e-10'), '1e-10');
});

test('a downloaded configuration restores the complete calculated plan in a fresh instance', async () => {
    const source = setup({ rungsInput: 2, skew: 0, feeValue: 1, feeSettlement: 'external' }, 'sell-only');
    const expected = source.calculate();
    const text = JSON.stringify(source.Config.capture(source.els));
    const target = setup();
    const h = target;
    for (const field of Object.values(h.els)) field.dispatchEvent = () => {};
    h.context.Event = class { constructor(type) { this.type = type; } };
    h.context.document = { getElementById: () => ({ click() {} }) };
    h.context.alert = message => { throw Error(message); };
    h.App.setTradingMode = mode => { h.State.tradingMode = mode; };
    h.context.window.OrderSkewModules.attachConfigMethods(h.App, h.els);
    const input = { files: [{ size: text.length, text: async () => text }], value: 'settings.json' };
    await h.App.loadConfig({ target: input });
    assert.equal(h.State.tradingMode, 'sell-only');
    assert.equal(h.els.currPriceSell.value, '100');
    assert.equal(input.value, '');
    assert.equal(JSON.stringify(h.State.currentPlanData), JSON.stringify(expected));
});

test('invalid uploaded settings leave the current plan and controls intact', async () => {
    const h = setup();
    const expected = h.calculate();
    const before = JSON.stringify(h.Config.capture(h.els));
    const messages = [];
    h.context.alert = message => messages.push(message);
    h.context.window.OrderSkewModules.attachConfigMethods(h.App, h.els);
    await h.App.loadConfig({ target: { files: [{ size: 4, text: async () => 'null' }] } });
    assert.equal(messages.length, 1);
    assert.equal(JSON.stringify(h.Config.capture(h.els)), before);
    assert.equal(h.State.currentPlanData, expected);
});

test('copy failure is reported without a false success toast', async () => {
    const h = setup();
    const toast = { classList: { add() {}, remove() {} } };
    h.context.navigator = { clipboard: { writeText: async () => { throw Error('Denied'); } } };
    h.context.document = {
        activeElement: { focus() {} }, body: { appendChild() {} }, execCommand: () => false,
        getElementById: () => toast, createElement: () => ({ style: {}, select() {}, remove() {} })
    };
    assert.equal(await h.Utils.copyToClipboard('95'), false);
    assert.match(toast.textContent, /Copy failed/);
});
