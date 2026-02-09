// OrderSkew - Main Application Bootstrap (main.js)

document.addEventListener('DOMContentLoaded', function () {
    // --- DOM ELEMENTS ---
    const els = {
        form: document.getElementById('trading-plan-form'),
        // Modes
        modeSimple: document.getElementById('mode-simple'),
        modePro: document.getElementById('mode-pro'),
        proControls: document.getElementById('pro-controls'),
        // Inputs
        startCap: document.getElementById('starting_capital'),
        startCapLabel: document.getElementById('starting_capital_label'),
        currPrice: document.getElementById('current_price'),
        rungs: document.getElementById('number_of_rungs'),
        rungsInput: document.getElementById('number_of_rungs_input'),
        rungsDisplay: document.getElementById('number_of_rungs_display'),
        depth: document.getElementById('depth'),
        depthInput: document.getElementById('depth_input'),
        depthDisplayLabel: document.getElementById('depth_display_label'),
        skew: document.getElementById('skew_value'),
        skewLabel: document.getElementById('skew_label'),
        priceRangeMode: document.getElementById('price_range_mode'),
        widthContainer: document.getElementById('width-mode-container'),
        floorContainer: document.getElementById('floor-mode-container'),
        buyFloor: document.getElementById('buy_floor'),
        sellCeiling: document.getElementById('sell_ceiling'),

        // Advanced
        sellOnlyCheck: document.getElementById('sell_only_mode'),
        sellOnlyInputs: document.getElementById('sell-only-inputs'),
        existQty: document.getElementById('existing_quantity'),
        existAvg: document.getElementById('existing_avg_price'),
        feeType: document.getElementById('fee_type'),
        feeValue: document.getElementById('fee_value'),
        feeSettlement: document.getElementById('fee_settlement'),
        spacingMode: document.getElementById('spacing_mode'),

        // Containers
        depthChartCard: document.getElementById('depth-chart-card'),

        // Tabs
        tabBuy: document.getElementById('tab-buy'),
        tabSell: document.getElementById('tab-sell'),
        panelBuy: document.getElementById('panel-buy'),
        panelSell: document.getElementById('panel-sell'),

        // Theme
        themeBtn: document.getElementById('theme-toggle-btn'),
        iconSun: document.getElementById('icon-sun'),
        iconMoon: document.getElementById('icon-moon'),

        // Sticky
        stickyFooter: document.getElementById('mobile-sticky-summary'),

        // Modals
        solBtn: document.getElementById('sol-btn'),
        qrModal: document.getElementById('qr-modal'),
        qrBackdrop: document.getElementById('qr-backdrop'),
        qrClose: document.getElementById('qr-close'),

        // Video
        videoBtn: document.getElementById('video-btn'),
        videoModal: document.getElementById('video-modal'),
        videoBackdrop: document.getElementById('video-backdrop'),
        videoClose: document.getElementById('video-close'),

        // Fees
        showFeesToggle: document.getElementById('show-fees-toggle'),
        copyDecimalPlaces: document.getElementById('copy-decimal-places'),

        // Sticky Extended
        stickyBtn: document.getElementById('sticky-expand-btn'),
        stickyChevron: document.getElementById('sticky-chevron'),
        stickyDetails: document.getElementById('sticky-details')
    };

    // Expose elements for wizard
    window.OrderSkewEls = els;

    const App = {
        calculatePlanDebounced: null,

        init: () => {
            App.calculatePlanDebounced = Utils.debounce(() => App.calculatePlan(), 50);
            App.loadTheme();
            App.loadAdvancedMode();
            App.loadCopyDecimalPlaces();
            App.bindEvents();
            App.togglePriceMode();

            // Show intro only if the user hasn't already seen it
            const introSeen = Utils.getCookie('os_intro_seen') === 'true';
            App.setIntroVisible(!introSeen);

            // Ensure minimal interface is applied on init
            App.applyAdvancedMode();

            // Initialize history state
            if (!history.state || typeof history.state.introVisible !== 'boolean') {
                history.replaceState({ introVisible: !introSeen }, '');
            }

            // Handle browser back button - consolidated handler
            window.addEventListener('popstate', () => {
                App.handleBackNavigation();
            });

            App.calculatePlan();
            App.ensureTableBottomSpace();
            window.addEventListener('resize', Utils.debounce(() => {
                App.calculatePlan();
                App.ensureTableBottomSpace();
                if (State.currentPlanData) {
                    App.updateUI(State.currentPlanData);
                }
            }, 200));
        }
    };

    const moduleAttachOrder = [
        'attachNavigationMethods',
        'attachUIMethods',
        'attachCalculatorMethods',
        'attachEventMethods'
    ];
    const modules = window.OrderSkewModules || {};

    moduleAttachOrder.forEach((attachName) => {
        const attachFn = modules[attachName];
        if (typeof attachFn === 'function') {
            attachFn(App, els);
        } else {
            console.error(`[OrderSkew] Missing module attach function: ${attachName}`);
        }
    });

    window.App = App;
    window.App.toggleExecutedGlobal = (rung) => {
        State.sellOnlyHighestExecuted = State.sellOnlyHighestExecuted === rung ? null : rung;
        App.calculatePlan();
    };

    // Initialize wizard controls
    if (typeof SetupWizard !== 'undefined') {
        SetupWizard.bindControls();
    }

    App.init();
});
