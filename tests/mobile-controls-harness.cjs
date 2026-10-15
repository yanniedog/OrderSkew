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


module.exports = mobileHarness;
