const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const visibleOpener of [true, false]) {
    test(`dialog close restores focus to ${visibleOpener ? 'its visible opener' : 'the calculator when the intro opener is hidden'}`, () => {
        let initialize, observe, open = false, openerVisible = true;
        const app = { inert: false };
        const modal = { classList: { contains: () => open }, setAttribute() {}, hasAttribute: () => true, querySelectorAll: () => [] };
        const document = {
            addEventListener: (name, callback) => { if (name === 'DOMContentLoaded') initialize = callback; },
            querySelectorAll: () => [],
            getElementById: id => ({ 'setup-wizard': modal, app, 'actions-menu-btn': fallback })[id]
        };
        const opener = { getClientRects: () => openerVisible ? [{}] : [], closest: () => null, focus: () => { document.activeElement = opener; } };
        const fallback = { focus: () => { document.activeElement = fallback; } };
        document.activeElement = opener;
        const context = vm.createContext({ document, getComputedStyle: () => ({ visibility: 'visible' }),
            MutationObserver: class { constructor(callback) { observe = callback; } observe() {} } });
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.accessibility.js'), 'utf8'), context);
        initialize();
        open = true;
        observe();
        assert.equal(app.inert, true);
        openerVisible = visibleOpener;
        open = false;
        observe();
        assert.equal(app.inert, false);
        assert.equal(modal.inert, true);
        assert.equal(document.activeElement, visibleOpener ? opener : fallback);
    });
}
