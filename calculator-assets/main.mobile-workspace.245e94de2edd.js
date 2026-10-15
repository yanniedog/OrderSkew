// Keep the graph in view on mobile without interrupting intentional navigation.
document.addEventListener('DOMContentLoaded', () => {
    const mobile = window.matchMedia('(max-width: 980px)');
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
    const showGraph = () => {
        if (mobile.matches) graph.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    let interacted = false;
    ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(type => {
        window.addEventListener(type, () => { interacted = true; }, { once: true, passive: true });
    });
    window.addEventListener('load', () => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const navigation = performance.getEntriesByType('navigation')[0];
            if (!interacted && !location.hash && window.scrollY === 0 && navigation?.type !== 'back_forward') showGraph();
        }));
    }, { once: true });
    window.addEventListener('orderskew:plan-ready', showGraph);
});
