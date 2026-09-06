// Keep collapsed settings understandable without adding more controls to the page.
document.addEventListener('DOMContentLoaded', () => {
    const field = id => document.getElementById(id);
    const value = id => field(id)?.value;
    const write = (id, text) => { if (field(id)) field(id).textContent = text; };
    const updateSummaries = () => {
        const range = value('price_range_mode') === 'floor' ? 'Fixed prices' : 'Percentage';
        const spacing = value('spacing_mode') === 'relative' ? 'equal % steps' : 'equal price steps';
        write('range-settings-summary', `${range} · ${spacing}`);
        const skew = Number(value('skew_value'));
        write('allocation-settings-summary', skew === 0 ? 'Equal amounts per order' : `${Utils.getSkewLabel(skew)} weighting`);
        const rawFee = value('fee_value');
        const fee = Number(rawFee);
        const percent = value('fee_type') === 'percent';
        const validFee = rawFee?.trim() && Number.isFinite(fee) && fee >= 0 && (!percent || fee < 100);
        const feeLabel = percent ? `${fee}%` : Utils.fmtCurrDisplay(fee);
        const settlement = value('fee_settlement') === 'external' ? 'paid separately' : 'deducted from orders';
        write('fee-settings-summary', !validFee ? 'Check the fee below' : fee === 0 ? 'No trading fees' : `${feeLabel} · ${settlement}`);
        const count = field('plan-order-count')?.textContent;
        write('orders-summary-count', State.currentPlanData ? `${count} · prices, quantities and CSV` : 'Complete your plan to see orders');
        document.querySelectorAll('.range-type-btn, .spacing-mode-btn, .fee-type-btn, .chart-toggle-btn')
            .forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    };
    const calculate = App.calculatePlan;
    App.calculatePlan = (...args) => {
        calculate(...args);
        updateSummaries();
    };
    const viewSettings = [...document.querySelectorAll('.view-settings')];
    document.addEventListener('click', event => {
        viewSettings.forEach(panel => { if (!panel.contains(event.target)) panel.open = false; });
        if (event.target.closest('.chart-toggle-btn')) updateSummaries();
    });
    viewSettings.forEach(panel => panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            panel.open = false;
            panel.querySelector('summary').focus();
        }
    }));
    // In-page navigation should reveal the table it points to, including direct links.
    const revealOrders = () => {
        if (location.hash === '#data-tables-card') field('data-tables-card').open = true;
    };
    document.querySelector('a[href="#data-tables-card"]')?.addEventListener('click', () => {
        field('data-tables-card').open = true;
    });
    window.addEventListener('hashchange', revealOrders);
    revealOrders();
    updateSummaries();
});
