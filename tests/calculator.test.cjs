const test = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./calculator-harness.cjs');
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-10), `${a} != ${b}`);

test('visible controls determine the plan in both disclosure modes', () => {
    const h = harness({ rungs: 2, rungsInput: 2, skew: 0, feeValue: 0, depth: 40, depthInput: 40 });
    const p = h.calculate();
    assert.equal(p.buyLadder.length, 2);
    close(p.buyLadder[0].price, 90);
    close(p.buyLadder[1].price, 70);
    close(p.buyLadder[0].capital, 25000);
    assert.equal(p.summary.totalFees, 0);
    h.State.mode = 'pro';
    assert.equal(JSON.stringify(h.calculate()), JSON.stringify(p));
});

test('buy-only has no fictional sells, profit, or sell fees', () => {
    const p = harness({}, 'buy-only').calculate();
    assert.equal(p.sellLadder.length, 0);
    assert.equal(p.summary.netProfit, null);
    assert.equal(p.summary.roi, null);
    close(p.summary.totalFees, sum(p.buyLadder, 'fee'));
});

test('sell-only uses entered holdings and cost basis, independent of old buy plans', () => {
    const h = harness({ skew: 0, rungs: 2, rungsInput: 2, feeValue: 1 }, 'sell-only');
    const p = h.calculate();
    assert.equal(p.buyLadder.length, 0);
    close(sum(p.sellLadder, 'assetSize'), 10);
    close(p.summary.avgBuy, 80);
    close(p.summary.netProfit, 289);
    close(sum(p.sellLadder, 'profit'), 289);
    close(p.summary.totalFees, 11);
});

test('missing cost basis does not claim profit', () => {
    const p = harness({ existAvg: '' }, 'sell-only').calculate();
    assert.equal(p.summary.netProfit, null);
    assert.equal(p.summary.roi, null);
    assert.ok(p.sellLadder.every(r => r.profit === null));
});

for (const settlement of ['netted', 'external']) {
    for (const feeType of ['percent', 'fixed']) {
        test(`${feeType} ${settlement}: cash, inventory, fees and row profit reconcile`, () => {
            const p = harness({ feeSettlement: settlement, feeType, feeValue: 5 }).calculate();
            const cost = sum(p.buyLadder, 'capital');
            const netSales = sum(p.sellLadder, 'netRevenue') - (settlement === 'external' ? sum(p.sellLadder, 'fee') : 0);
            close(p.summary.netProfit, netSales - cost);
            close(sum(p.sellLadder, 'profit'), p.summary.netProfit);
            close(sum(p.buyLadder, 'assetSize'), sum(p.sellLadder, 'assetSize'));
            close(p.summary.avgBuy, sum(p.buyLadder, 'netCapital') / sum(p.buyLadder, 'assetSize'));
        });
    }
}

for (const fields of [
    { startCap: '' }, { startCap: -1 }, { currPrice: 0 }, { currPrice: 'Infinity' },
    { rungsInput: 51 }, { rungsInput: 1 }, { rungsInput: 2.5 }, { rungsInput: '' },
    { depthInput: 0 }, { depthInput: 100 }, { depthInput: '' },
    { feeValue: -1 }, { feeValue: 101 },
    { priceRangeMode: 'floor', buyFloor: '' }, { priceRangeMode: 'floor', buyFloor: -80 },
    { priceRangeMode: 'floor', buyFloor: 100 }, { priceRangeMode: 'floor', sellCeiling: 90 },
    { priceRangeMode: 'floor', sellCeiling: '' }
]) test(`invalid inputs clear outputs: ${JSON.stringify(fields)}`, () => {
    const h = harness(fields);
    assert.equal(h.calculate(), null);
    assert.equal(h.App.validation.isReady, false);
});

test('fixed fees that exhaust an order are rejected', () => {
    const h = harness({ startCap: 10, feeType: 'fixed', feeValue: 10 }, 'buy-only');
    assert.equal(h.calculate(), null);
});

test('spacing, price scale and order-count matrix remains finite and reconciles', () => {
    let scenarios = 0;
    for (const price of [1e-10, 0.01, 100, 1e12]) for (const n of [2, 10, 50])
    for (const skew of [0, 50, 100]) for (const spacingMode of ['absolute', 'relative']) {
        const p = harness({ currPrice: price, rungs: n, rungsInput: n, skew, spacingMode }).calculate();
        assert.ok(p, `price ${price}, N ${n}, skew ${skew}, ${spacingMode}`);
        assert.equal(p.buyLadder.length, n);
        close(sum(p.buyLadder, 'capital'), 50000);
        close(sum(p.sellLadder, 'profit'), p.summary.netProfit);
        for (const r of [...p.buyLadder, ...p.sellLadder]) {
            assert.ok(Object.values(r).every(v => typeof v !== 'number' || Number.isFinite(v)));
            assert.ok(r.price > 0 && r.assetSize > 0);
        }
        close(p.summary.avgBuy, sum(p.buyLadder, 'netCapital') / sum(p.buyLadder, 'assetSize'));
        scenarios++;
    }
    assert.equal(scenarios, 72);
});
