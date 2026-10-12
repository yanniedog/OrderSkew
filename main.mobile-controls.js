// Mobile shortcuts use the full form events and validation as the source of truth.
{
    const field = id => document.getElementById(id);
    function stepControl(control, direction) {
        const raw = Number(control.input.value);
        const current = Number.isFinite(raw) ? raw : 0;
        const whole = control.name === 'orders' || control.name === 'range';
        const step = whole ? 1 : 10 ** (Math.floor(Math.log10(Math.abs(current) || 100)) - 2);
        const min = control.name === 'orders' ? 2 : control.name === 'range' ? 0.1 : step;
        const max = control.input.max ? Number(control.input.max) : Infinity;
        const next = Number(Math.min(max, Math.max(min, current + direction * step)).toPrecision(12));
        if (next === current) return false;
        control.input.value = String(next);
        control.input.dispatchEvent(new Event('input', { bubbles: true }));
        return next > min && next < max;
    }
    function bindStepButton(button, step) {
        let timer;
        let activePointer;
        let suppressClick = false;
        const stop = () => { clearTimeout(timer); timer = null; activePointer = undefined; };
        const repeat = () => {
            if (button.getClientRects?.().length === 0 || step() === false) return stop();
            timer = setTimeout(repeat, 100);
        };
        button.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.isPrimary === false || activePointer !== undefined) return;
            event.preventDefault();
            stop();
            suppressClick = true;
            activePointer = event.pointerId;
            button.focus({ preventScroll: true });
            button.setPointerCapture?.(event.pointerId);
            if (step() !== false) timer = setTimeout(repeat, 350);
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
    }
    function addSteppers(control) {
        const group = document.createElement('div');
        group.className = 'mobile-stepper';
        const buttons = [-1, 1].map(direction => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = direction < 0 ? '−' : '+';
            bindStepButton(button, () => stepControl(control, direction));
            return button;
        });
        group.append(buttons[0], control.input, buttons[1]);
        control.label.append(group);
        control.buttons = buttons;
    }
    function createControl([name, title, sourceId], grid) {
        const label = document.createElement('div');
        label.className = 'mobile-control-field';
        const caption = document.createElement('label');
        const input = document.createElement('input');
        caption.textContent = title;
        input.id = `mobile-control-${name}`;
        input.className = 'form-input';
        input.type = name === 'skew' ? 'range' : 'number';
        input.inputMode = name === 'orders' ? 'numeric' : 'decimal';
        caption.htmlFor = input.id;
        label.append(caption);
        grid.append(label);
        const control = { name, sourceId, label, caption, input };
        if (name === 'skew') label.append(input);
        else addSteppers(control);
        input.addEventListener('input', () => {
            const source = field(control.sourceId);
            source.value = input.value;
            source.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return control;
    }
    function syncControl(control, sell, fixed) {
        if (control.name === 'amount') {
            control.sourceId = sell ? 'existing_quantity' : 'starting_capital';
            control.caption.textContent = sell ? 'Held quantity' : 'Capital ($)';
        }
        if (control.name === 'price') control.sourceId = sell ? 'current_price_sell' : 'current_price';
        const source = field(control.sourceId);
        control.label.hidden = (control.name === 'range' && fixed)
            || (control.name === 'low' && (!fixed || sell))
            || (control.name === 'high' && (!fixed || State.tradingMode === 'buy-only'));
        // Preserve an in-progress decimal or empty entry while the user types.
        if (document.activeElement !== control.input) control.input.value = Utils.stripCommas(source.value);
        control.input.min = source.min || '0';
        control.input.max = source.max || '';
        control.input.step = source.step || (control.name === 'orders' || control.name === 'skew' ? '1' : 'any');
        control.input.setAttribute('aria-invalid', source.getAttribute('aria-invalid') || 'false');
        if (control.name === 'skew') control.caption.textContent = `Skew · ${source.value}`;
        control.buttons?.forEach((button, index) => {
            button.setAttribute('aria-label', `${index ? 'Increase' : 'Decrease'} ${control.caption.textContent}`);
        });
    }
    function bindPanel(panel) {
        const toggle = field('mobile-skew-toggle');
        toggle?.addEventListener('click', event => {
            event.preventDefault();
            const skew = field('mobile-controls-skew');
            skew.hidden = !skew.hidden;
            toggle.setAttribute('aria-expanded', String(!skew.hidden));
            panel.open = true;
        });
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                panel.open = false;
                panel.querySelector('summary').focus();
            }
        });
    }
    document.addEventListener('DOMContentLoaded', () => {
        const panel = field('mobile-controls');
        const grid = field('mobile-controls-fields');
        if (!panel || !window.App) return;
        const definitions = [
            ['amount', 'Capital ($)', 'starting_capital'],
            ['price', 'Price ($)', 'current_price'],
            ['orders', 'Orders', 'number_of_rungs_input'],
            ['range', 'Range (%)', 'depth_input'],
            ['low', 'Buy low ($)', 'buy_floor'],
            ['high', 'Sell high ($)', 'sell_ceiling'],
            ['skew', 'Skew', 'skew_value']
        ];
        const controls = definitions.map(definition => createControl(definition,
            definition[0] === 'skew' ? field('mobile-controls-skew') : grid));
        const sync = () => {
            const sell = State.tradingMode === 'sell-only';
            const fixed = field('price_range_mode').value === 'floor';
            controls.forEach(control => syncControl(control, sell, fixed));
            field('mobile-controls-status').textContent = State.currentPlanData ? 'Live' : 'Check inputs';
        };
        const calculate = App.calculatePlan;
        App.calculatePlan = (...args) => { calculate(...args); sync(); };
        bindPanel(panel);
        sync();
    });
}
