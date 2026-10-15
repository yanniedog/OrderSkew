// Keep the graph in view on mobile without interrupting intentional navigation.
let mobileWorkspaceInteracted = false;
['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(type => {
    window.addEventListener(type, () => { mobileWorkspaceInteracted = true; }, { once: true, passive: true });
});
function orderMobileWorkspace(mobile) {
    const field = id => document.getElementById(id);
    const focused = document.activeElement;
    if (mobile.matches) {
        field('config-column').before(field('graph-column'));
        field('chart-summary-overlay').before(field('depth-chart-card'));
    } else {
        field('config-column').after(field('graph-column'));
        field('chart-summary-overlay').after(field('depth-chart-card'));
    }
    if (focused !== document.activeElement) focused?.focus({ preventScroll: true });
}
document.addEventListener('DOMContentLoaded', () => {
    const mobile = window.matchMedia('(max-width: 980px)');
    orderMobileWorkspace(mobile);
    mobile.addEventListener('change', () => orderMobileWorkspace(mobile));
    const graph = document.getElementById('depth-chart-card');
    const settingIds = new Set(['range-settings', 'fee-settings']);
    const revealSetting = () => {
        const id = location.hash.slice(1);
        if (settingIds.has(id)) document.getElementById(id).open = true;
    };
    document.querySelectorAll('[data-mobile-setting]').forEach(link => {
        link.addEventListener('click', () => {
            document.getElementById(link.hash.slice(1)).open = true;
        });
    });
    window.addEventListener('hashchange', revealSetting);
    revealSetting();
    const showGraph = (focus = false) => {
        // Modal focus restoration runs in a mutation observer before the next frame.
        requestAnimationFrame(() => {
            if (!mobile.matches) return;
            graph.scrollIntoView({ block: 'start', behavior: 'instant' });
            if (focus) graph.focus({ preventScroll: true });
        });
    };
    window.addEventListener('load', () => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const navigation = performance.getEntriesByType('navigation')[0];
            if (!mobileWorkspaceInteracted && !location.hash && window.scrollY === 0 && navigation?.type !== 'back_forward') showGraph();
        }));
    }, { once: true });
    window.addEventListener('orderskew:plan-ready', () => showGraph(true));
});
