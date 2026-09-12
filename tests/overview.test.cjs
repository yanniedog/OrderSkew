const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = require('./calculator-harness.cjs');

function overview(mode) {
    const h = harness({ startCap: 1000, rungsInput: 2, skew: 0, feeValue: 1 }, mode);
    const ids = ['plan-primary-label', 'plan-primary-value', 'plan-average-label', 'plan-average-value',
        'plan-order-count', 'plan-range', 'chart-summary-total-quantity', 'chart-summary-total-fees',
        'chart-summary-net-profit', 'chart-summary-roi', 'chart-summary-overlay', 'profit-note'];
    const nodes = Object.fromEntries(ids.map(id => {
        const classes = new Set();
        return [id, { textContent: '', classList: {
            add: name => classes.add(name), remove: name => classes.delete(name),
            contains: name => classes.has(name)
        } }];
    }));
    h.context.document = { getElementById: id => nodes[id] || null, querySelector: () => null, querySelectorAll: () => [] };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.ui.js'), 'utf8'), h.context);
    h.context.window.OrderSkewModules.attachUIMethods(h.App, h.els);
    return { ...h, nodes, text: id => nodes[id].textContent };
}

test('sell overview shows sale proceeds and net exit, without reusing the hidden buy budget', () => {
    const h = overview('sell-only');
    h.calculate();
    assert.equal(h.text('plan-primary-label'), 'Sell order value');
    assert.equal(h.text('plan-primary-value'), '$1,100');
    assert.equal(h.text('plan-average-label'), 'Avg. net exit');
    assert.equal(h.text('plan-average-value'), '$108.9');
    assert.equal(h.text('chart-summary-total-quantity'), '10');
    assert.equal(h.text('chart-summary-total-fees'), '$11');
    assert.equal(h.text('chart-summary-net-profit'), '$289');
    assert.equal(h.text('plan-range'), '$105 – $115');
});

test('buy-only overview excludes hypothetical sell orders from its count and range', () => {
    const h = overview('buy-only');
    h.calculate();
    assert.equal(h.text('plan-primary-value'), '$1,000');
    assert.equal(h.text('plan-order-count'), '2 orders');
    assert.equal(h.text('plan-range'), '$85 – $95');
    assert.equal(h.text('chart-summary-net-profit'), '—');
});

test('combined overview counts both ladders and spans actual buy and sell prices', () => {
    const h = overview('buy-sell');
    h.calculate();
    assert.equal(h.text('plan-order-count'), '4 orders');
    assert.equal(h.text('plan-range'), '$85 – $115');
});

test('invalid edits clear new overview values and the chart range instead of leaving stale figures', () => {
    const h = overview('buy-sell');
    h.calculate();
    h.els.rungsInput.value = '2.5';
    assert.equal(h.calculate(), null);
    assert.ok(h.nodes['chart-summary-overlay'].classList.contains('hidden'));
    for (const id of ['plan-primary-value', 'plan-average-value', 'plan-order-count', 'plan-range'])
        assert.equal(h.text(id), '-');
    h.els.rungsInput.value = '2';
    assert.ok(h.calculate());
    assert.equal(h.nodes['chart-summary-overlay'].classList.contains('hidden'), false);
    assert.equal(h.text('plan-order-count'), '4 orders');
});
