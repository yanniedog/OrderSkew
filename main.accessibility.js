// Keep closed overlays out of keyboard navigation and give fields accessible names.
{
    const labelFields = () => {
        const labels = {
            starting_capital: 'Initial Capital', current_price: 'Reference price',
            current_price_sell: 'Reference price', existing_quantity: 'Held Quantity',
            existing_avg_price: 'Average Cost Basis', number_of_rungs: 'Number of Orders slider',
            number_of_rungs_input: 'Orders per side', depth: 'Range percentage slider', depth_input: 'Price range (%)',
            skew_value: 'Capital Skew', fee_value: 'Trading Fee', fee_settlement: 'Fee Settlement',
            buy_floor: 'Buy Range Low', sell_ceiling: 'Sell Range High', 'donation-chain': 'Blockchain'
        };
        Object.entries(labels).forEach(([id, label]) => document.getElementById(id)?.setAttribute('aria-label', label));
        document.querySelectorAll('.helper-tooltip').forEach(button => {
            button.setAttribute('aria-label', 'Help: ' + (button.parentElement.querySelector('label')?.textContent.trim() || 'setting'));
        });
    };
    const bindDialogKeys = (getActive, focusable) => {
        document.addEventListener('keydown', event => {
            const active = getActive();
            if (event.key === 'Escape' && active?.id === 'setup-wizard') {
                active.classList.remove('open');
                active.style.opacity = '0'; active.style.pointerEvents = 'none';
            }
            if (event.key !== 'Tab' || !active) return;
            const nodes = focusable(active);
            if (!nodes.length) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === nodes[0] || !active.contains(document.activeElement))) {
                event.preventDefault(); nodes.at(-1).focus();
            } else if (!event.shiftKey && (document.activeElement === nodes.at(-1) || !active.contains(document.activeElement))) {
                event.preventDefault(); nodes[0].focus();
            }
        });
    };
    const bindModals = () => {
        const modals = ['how-it-works-modal', 'qr-modal', 'video-modal', 'setup-wizard']
            .map(id => document.getElementById(id)).filter(Boolean);
        const focusable = el => [...el.querySelectorAll('button, input, select, a[href], iframe, summary, [tabindex="0"]')]
            .filter(node => !node.disabled && !node.closest('[inert]') && node.getClientRects().length);
        let active = null;
        const openers = new WeakMap();
        const sync = () => {
            const next = modals.find(el => el.classList.contains('open')) || null;
            for (const modal of modals) {
                modal.inert = modal !== next;
                modal.setAttribute('aria-hidden', String(modal !== next));
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                if (!modal.hasAttribute('aria-label') && !modal.hasAttribute('aria-labelledby'))
                    modal.setAttribute('aria-label', modal.querySelector('h2, h3')?.textContent || 'Tutorial');
            }
            if (next === active) return;
            const app = document.getElementById('app');
            if (app) app.inert = false;
            if (active && !next) {
                const opener = openers.get(active);
                const available = opener?.getClientRects().length && getComputedStyle(opener).visibility !== 'hidden' && !opener.closest('[inert]');
                const target = available ? opener : document.getElementById('actions-menu-btn');
                target?.focus();
            }
            if (next) {
                openers.set(next, document.activeElement);
                focusable(next)[0]?.focus();
            }
            active = next;
            if (app) app.inert = !!next;
        };
        modals.forEach(modal => new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['class'] }));
        sync();
        bindDialogKeys(() => active, focusable);
    };
    const bindFilePickers = () => {
        document.querySelectorAll('label:has(input[type="file"])').forEach(label => {
            label.tabIndex = 0;
            label.setAttribute('role', 'button');
            label.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); label.querySelector('input').click();
                }
            });
        });
    };
    document.addEventListener('DOMContentLoaded', () => {
        labelFields();
        bindModals();
        bindFilePickers();
    });
}
