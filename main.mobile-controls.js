// Mobile shortcuts use the full form's events and validation as the source of truth.
document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('mobile-controls');
    const grid = document.getElementById('mobile-controls-fields');
    if (!panel || !window.App) return;
    const field = id => document.getElementById(id);
    const definitions = [
        ['amount', 'Capital ($)', 'starting_capital'],
        ['price', 'Price ($)', 'current_price'],
        ['orders', 'Orders', 'number_of_rungs_input'],
        ['range', 'Range (%)', 'depth_input'],
        ['low', 'Buy low ($)', 'buy_floor'],
        ['high', 'Sell high ($)', 'sell_ceiling'],
        ['skew', 'Skew', 'skew_value']
    ];
    const controls = definitions.map(([name, title, sourceId]) => {
        const label = document.createElement('label');
        const caption = document.createElement('span');
        const input = document.createElement('input');
        caption.textContent = title;
        input.id = `mobile-control-${name}`;
        input.className = 'form-input';
        input.type = name === 'skew' ? 'range' : 'number';
        input.inputMode = name === 'orders' ? 'numeric' : 'decimal';
        label.htmlFor = input.id;
        label.append(caption, input);
        grid.append(label);
        const control = { name, sourceId, label, caption, input };
        input.addEventListener('input', () => {
            const source = field(control.sourceId);
            source.value = input.value;
            source.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return control;
    });
    const sync = () => {
        const sell = State.tradingMode === 'sell-only';
        const fixed = field('price_range_mode').value === 'floor';
        controls.forEach(control => {
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
        });
        field('mobile-controls-status').textContent = State.currentPlanData ? 'Live' : 'Check inputs';
    };
    const calculate = App.calculatePlan;
    App.calculatePlan = (...args) => { calculate(...args); sync(); };
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            panel.open = false;
            panel.querySelector('summary').focus();
        }
    });
    sync();
});
