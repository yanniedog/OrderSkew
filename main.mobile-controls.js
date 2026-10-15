// Mobile shortcuts use the full form events and validation as the source of truth.
{
    const field = id => document.getElementById(id);
    function bindStepButton(button, step) {
        let timer, activePointer;
        let suppressClick = false;
        const stop = () => { clearTimeout(timer); timer = null; activePointer = undefined; };
        const repeat = () => {
            if (button.getClientRects?.().length === 0 || step() === false) return stop();
            if (activePointer !== undefined) timer = setTimeout(repeat, 100);
        };
        button.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.isPrimary === false || activePointer !== undefined) return;
            event.preventDefault();
            stop();
            suppressClick = true;
            activePointer = event.pointerId;
            button.focus({ preventScroll: true });
            button.setPointerCapture?.(event.pointerId);
            if (step() !== false && activePointer === event.pointerId) timer = setTimeout(repeat, 350);
        });
        button.addEventListener('click', event => {
            if (event.detail === 0 || !suppressClick) step();
            if (event.detail !== 0) suppressClick = false;
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, event => {
            if (event.pointerId === activePointer) stop();
        }));
        button.addEventListener('contextmenu', event => event.preventDefault());
        window.addEventListener('blur', stop);
        window.addEventListener('pagehide', stop);
        document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
        return stop;
    }
    function describe(control) {
        const sell = State.tradingMode === 'sell-only';
        const fixed = field('price_range_mode').value === 'floor';
        if (control.name === 'amount') {
            control.sourceId = sell ? 'existing_quantity' : 'starting_capital';
            control.title = sell ? 'Quantity' : 'Capital';
        }
        if (control.name === 'price') control.sourceId = sell ? 'current_price_sell' : 'current_price';
        control.button.hidden = (control.name === 'range' && fixed)
            || (control.name === 'low' && (!fixed || sell))
            || (control.name === 'high' && (!fixed || State.tradingMode === 'buy-only'));
        control.button.textContent = control.title;
        return Number(Utils.stripCommas(field(control.sourceId).value));
    }
    function anchorValue(control, value) {
        const raw = Number(Utils.stripCommas(field(State.tradingMode === 'sell-only' ? 'current_price_sell' : 'current_price').value));
        const reference = Number.isFinite(raw) && raw > 0 ? raw : 1;
        const usable = Number.isFinite(value) && value > 0
            && (control.name !== 'low' || value < reference)
            && (control.name !== 'high' || value > reference);
        if (usable) return value;
        if (control.sourceId === 'existing_quantity') return 100 / reference;
        if (['low', 'high'].includes(control.name)) return reference;
        if (control.name === 'price') return 1;
        return 100;
    }
    function limits(control, value) {
        if (control.name === 'orders') return { min: 2, max: 50, step: 1 };
        if (control.name === 'range') return { min: 0.1, max: 99, step: 0.1 };
        if (control.name === 'skew') return { min: 0, max: 100, step: 1 };
        const anchor = anchorValue(control, value);
        const step = Number((10 ** (Math.floor(Math.log10(anchor)) - 2)).toPrecision(12));
        let min = control.sourceId === 'existing_quantity' ? 0 : step;
        let max = Number((anchor * 2).toPrecision(12));
        const price = Number(Utils.stripCommas(field('current_price').value));
        if (control.name === 'low' && price > step) max = price - step;
        if (control.name === 'high') {
            const reference = Number(Utils.stripCommas(field(State.tradingMode === 'sell-only' ? 'current_price_sell' : 'current_price').value));
            min = Number((reference + step).toPrecision(12));
            max = Math.max(max, reference * 2);
        }
        return { min, max, step };
    }
    function displayValue(control, value) {
        if (!Number.isFinite(value) || field(control.sourceId).value.trim() === '') return 'Check input';
        const text = Number(value.toPrecision(8)).toLocaleString(undefined, { maximumSignificantDigits: 8 });
        if (control.name === 'range') return `${text}%`;
        return ['amount', 'price', 'low', 'high'].includes(control.name) && control.sourceId !== 'existing_quantity' ? `$${text}` : text;
    }
    function buildPicker(picker, select) {
        return [['amount', 'Capital', 'starting_capital'], ['price', 'Price', 'current_price'],
            ['orders', 'Orders', 'number_of_rungs_input'], ['range', 'Range', 'depth_input'],
            ['skew', 'Skew', 'skew_value'], ['low', 'Buy low', 'buy_floor'], ['high', 'Sell high', 'sell_ceiling']]
            .map(([name, title, sourceId]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.id = `mobile-parameter-${name}`;
                button.setAttribute('role', 'tab');
                button.setAttribute('aria-controls', 'mobile-slider-panel');
                picker.append(button);
                const control = { name, title, sourceId, button };
                button.addEventListener('click', () => select(control, true));
                return control;
            });
    }
    function bindPicker(picker, controls, select, current) {
        picker.addEventListener('scroll', () => {
            const center = picker.getBoundingClientRect().top + picker.clientHeight / 2;
            const visible = controls.filter(control => !control.button.hidden);
            const nearest = visible.reduce((best, control) => {
                const distance = button => Math.abs(button.getBoundingClientRect().top + button.getBoundingClientRect().height / 2 - center);
                return distance(control.button) < distance(best.button) ? control : best;
            });
            if (nearest !== current()) select(nearest, false);
        });
        picker.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const visible = controls.filter(control => !control.button.hidden);
            const index = visible.indexOf(current());
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
                : Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
            select(visible[next], true);
            visible[next].button.focus({ preventScroll: true });
        });
    }
    function render(model) {
        const { controls, picker, slider } = model;
        controls.forEach(describe);
        if (!model.selected || model.selected.button.hidden) {
            model.stops.forEach(stop => stop());
            model.selected = controls.find(control => !control.button.hidden);
            model.bounds = null;
            model.selected.button.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        }
        const selected = model.selected, value = describe(selected);
        const usesReference = ['low', 'high'].includes(selected.name) || selected.sourceId === 'existing_quantity';
        const references = usesReference ? ['current_price', 'current_price_sell']
            .map(id => Number(Utils.stripCommas(field(id).value))).join(':') : '';
        const key = `${selected.sourceId}:${State.tradingMode}:${field('price_range_mode').value}:${references}`;
        if (model.key && model.key !== key) model.stops.forEach(stop => stop());
        if (!model.bounds || model.key !== key || value < model.bounds.min || value > model.bounds.max) model.bounds = limits(selected, value);
        model.key = key;
        controls.forEach(control => {
            control.button.setAttribute('aria-selected', String(control === selected));
            control.button.tabIndex = control === selected ? 0 : -1;
        });
        Object.assign(slider, model.bounds, { value: String(value) });
        slider.setAttribute('aria-label', selected.title);
        slider.setAttribute('aria-valuetext', displayValue(selected, value));
        slider.setAttribute('aria-invalid', field(selected.sourceId).getAttribute('aria-invalid') || 'false');
        field('mobile-slider-panel').setAttribute('aria-labelledby', selected.button.id);
        field('mobile-control-value').textContent = displayValue(selected, value);
        field('mobile-controls-status').textContent = State.currentPlanData ? 'Live' : 'Check inputs';
    }
    function setup(panel) {
        const picker = field('mobile-parameter-picker'), slider = field('mobile-control-slider');
        const model = { picker, slider };
        const sync = () => render(model);
        const stops = model.stops = [];
        const select = (control, center) => {
            stops.forEach(stop => stop());
            model.selected = control;
            model.bounds = null;
            sync();
            if (center) control.button.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        };
        const controls = model.controls = buildPicker(picker, select);
        const apply = value => {
            const source = field(model.selected.sourceId);
            source.value = String(Number(value.toPrecision(12)));
            source.dispatchEvent(new Event('input', { bubbles: true }));
        };
        slider.addEventListener('input', () => apply(Number(slider.value)));
        [-1, 1].forEach(direction => stops.push(bindStepButton(field(direction < 0 ? 'mobile-step-down' : 'mobile-step-up'), () => {
            const value = describe(model.selected);
            const fine = limits(model.selected, value);
            const max = ['orders', 'range', 'skew', 'low'].includes(model.selected.name) ? fine.max : Infinity;
            const next = Math.min(max, Math.max(fine.min, value + direction * fine.step));
            if (!Number.isFinite(next) || next === value) return false;
            apply(next);
            return next > fine.min && next < max;
        })));
        bindPicker(picker, controls, select, () => model.selected);
        const calculate = App.calculatePlan;
        App.calculatePlan = (...args) => { calculate(...args); sync(); };
        panel.addEventListener('toggle', () => {
            stops.forEach(stop => stop());
            if (panel.open) model.selected.button.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        });
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') { panel.open = false; panel.querySelector('summary').focus(); }
        });
        sync();
    }
    document.addEventListener('DOMContentLoaded', () => {
        const panel = field('mobile-controls');
        if (panel && window.App) setup(panel);
    });
}
