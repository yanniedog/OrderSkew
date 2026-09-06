const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = function harness(overrides = {}, mode = 'buy-sell') {
    const context = vm.createContext({ window: {}, console, Intl, setTimeout, clearTimeout });
    for (const file of ['app.js', 'calculator.plan.js', 'main.calculator.js']) {
        const name = path.join(__dirname, '..', file);
        if (fs.existsSync(name)) vm.runInContext(fs.readFileSync(name, 'utf8'), context);
    }
    const values = { startCap: '50000', currPrice: '100', currPriceSell: '100',
        rungs: '10', rungsInput: '10', skew: '50', depth: '20', depthInput: '20',
        priceRangeMode: 'width', buyFloor: '80', sellCeiling: '120',
        feeType: 'percent', feeValue: '0.1', feeSettlement: 'netted',
        spacingMode: 'absolute', existQty: '10', existAvg: '80', ...overrides };
    const els = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value: String(value) }]));
    els.sellOnlyCheck = { checked: mode === 'sell-only' };
    const { State, Calculator, Utils } = context.window;
    Object.assign(State, { tradingMode: mode, buyOnlyMode: mode === 'buy-only', sellOnlyMode: mode === 'sell-only' });
    const App = { resetCopyCellHighlights() {}, updateUI() {}, setPendingOutputs(v) { this.validation = v; } };
    context.window.OrderSkewModules.attachCalculatorMethods(App, els);
    return { App, State, Calculator, Utils, els, context, calculate() { App.calculatePlan(); return State.currentPlanData; } };
};
