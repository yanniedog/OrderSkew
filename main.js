// OrderSkew - Main Application Initialization (main.js)

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
        videoBtnMobile: document.getElementById('video-btn-mobile'),
        videoModal: document.getElementById('video-modal'),
        videoBackdrop: document.getElementById('video-backdrop'),
        videoClose: document.getElementById('video-close'),

        // Fees
        showFeesToggle: document.getElementById('show-fees-toggle'),

        // Sticky Extended
        stickyBtn: document.getElementById('sticky-expand-btn'),
        stickyChevron: document.getElementById('sticky-chevron'),
        stickyDetails: document.getElementById('sticky-details')
    };

    // Expose elements for wizard
    window.OrderSkewEls = els;

    // --- APP LOGIC ---
    const App = {
        init: () => {
            App.loadTheme();
            App.loadAdvancedMode();
            App.bindEvents();
            
            // Show intro only if the user hasn't already seen it
            const introLayer = document.getElementById('intro-layer');
            const introSeen = Utils.getCookie('os_intro_seen') === 'true';
            if (introLayer) {
                if (introSeen) {
                    introLayer.style.display = 'none';
                    introLayer.style.opacity = '0';
                    introLayer.style.pointerEvents = 'none';
                } else {
                    introLayer.style.display = 'flex';
                    introLayer.style.opacity = '1';
                    introLayer.style.pointerEvents = 'auto';
                }
            }
            
            // Ensure minimal interface is applied on init
            App.applyAdvancedMode();
            
            // Initialize history state
            if (!history.state || !history.state.introVisible) {
                history.replaceState({ introVisible: !introSeen }, '');
            }
            
            // Handle browser back button - consolidated handler
            window.addEventListener('popstate', (e) => {
                App.handleBackNavigation();
            });
            
            App.calculatePlan();
            App.ensureTableBottomSpace();
            // #region agent log
            (function logLayout() {
                const mainGrid = document.getElementById('main-content-grid');
                const configCol = document.getElementById('config-column');
                const graphCol = document.getElementById('graph-column');
                const chartCard = document.getElementById('depth-chart-card');
                const header = document.querySelector('header');
                const app = document.getElementById('app');
                const dataTables = document.getElementById('data-tables-card');
                const tableEl = document.querySelector('#panel-buy table');
                const data = {
                    viewportW: window.innerWidth,
                    viewportH: window.innerHeight,
                    mainGridClass: mainGrid?.className || '',
                    mainGridDisplay: mainGrid ? getComputedStyle(mainGrid).display : '',
                    mainGridGridTemplate: mainGrid ? getComputedStyle(mainGrid).gridTemplateColumns : '',
                    configRect: configCol ? { w: configCol.offsetWidth, h: configCol.offsetHeight } : null,
                    graphRect: graphCol ? { w: graphCol.offsetWidth, h: graphCol.offsetHeight } : null,
                    chartCardRect: chartCard ? { w: chartCard.offsetWidth, h: chartCard.offsetHeight } : null,
                    headerRect: header ? { w: header.offsetWidth, h: header.offsetHeight } : null,
                    appRect: app ? { w: app.offsetWidth } : null,
                    mainRect: mainGrid?.parentElement ? { w: mainGrid.parentElement.offsetWidth } : null,
                    dataTablesW: dataTables?.offsetWidth ?? null,
                    tableW: tableEl?.offsetWidth ?? null,
                    isLg: window.innerWidth >= 1024
                };
                fetch('http://127.0.0.1:7244/ingest/0500be7a-802e-498d-b34c-96092e89bf3b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:init',message:'Layout state',data:data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'layout'})}).catch(()=>{});
            })();
            setTimeout(function() {
                const configCol = document.getElementById('config-column');
                const graphCol = document.getElementById('graph-column');
                const chartCard = document.getElementById('depth-chart-card');
                fetch('http://127.0.0.1:7244/ingest/0500be7a-802e-498d-b34c-96092e89bf3b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:init:delayed',message:'Layout after paint',data:{configW:configCol?.offsetWidth,graphW:graphCol?.offsetWidth,chartW:chartCard?.offsetWidth},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'layout'})}).catch(()=>{});
            }, 500);
            // #endregion
            window.addEventListener('resize', Utils.debounce(() => {
                App.calculatePlan();
                App.ensureTableBottomSpace();
                if (State.currentPlanData) {
                    App.updateUI(State.currentPlanData);
                }
            }, 200));
        },
        
        ensureTableBottomSpace: () => {
            const tableContainer = document.querySelector('.card.overflow-hidden');
            if (!tableContainer) return;
            
            const isMobile = window.innerWidth < 1024;
            tableContainer.style.marginBottom = isMobile ? '24px' : '48px';
        },

        loadTheme: () => {
            const saved = localStorage.getItem(CONSTANTS.STORAGE_PREFIX + 'theme');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            State.theme = saved || (prefersDark ? 'dark' : 'light');
            App.applyTheme();
        },

        toggleTheme: () => {
            State.theme = State.theme === 'light' ? 'dark' : 'light';
            localStorage.setItem(CONSTANTS.STORAGE_PREFIX + 'theme', State.theme);
            App.applyTheme();
        },

        applyTheme: () => {
            document.body.className = document.body.className.replace(/theme-\w+/, `theme-${State.theme}`);
            if (State.theme === 'dark') {
                els.iconSun?.classList.remove('hidden');
                els.iconMoon?.classList.add('hidden');
            } else {
                els.iconSun?.classList.add('hidden');
                els.iconMoon?.classList.remove('hidden');
            }
            // Update theme toggle text in menu
            const themeToggleText = document.getElementById('theme-toggle-text');
            if (themeToggleText) {
                themeToggleText.textContent = State.theme === 'dark' ? 'Light Mode' : 'Dark Mode';
            }
            App.calculatePlan();
        },

        loadAdvancedMode: () => {
            const saved = localStorage.getItem(CONSTANTS.STORAGE_PREFIX + 'advanced_mode');
            State.advancedMode = saved === 'true';
            App.applyAdvancedMode();
        },

        toggleAdvancedMode: () => {
            State.advancedMode = !State.advancedMode;
            localStorage.setItem(CONSTANTS.STORAGE_PREFIX + 'advanced_mode', State.advancedMode.toString());
            App.applyAdvancedMode();
        },

        applyAdvancedMode: () => {
            const advancedToggle = document.getElementById('advanced-mode-toggle');
            const modeToggleContainer = document.getElementById('mode-toggle-container');
            const chartDisplayOptions = document.getElementById('chart-display-options');
            const tableOptions = document.getElementById('table-options');
            const exportMenu = document.getElementById('export-menu');
            const advancedModeOptions = document.querySelectorAll('.mode-dropdown-advanced');
            
            if (advancedToggle) {
                // Sync checkbox checked state with State.advancedMode
                advancedToggle.checked = State.advancedMode;
                if (State.advancedMode) {
                    advancedToggle.classList.add('bg-[var(--color-primary)]/20', 'text-[var(--color-primary)]');
                    advancedToggle.classList.remove('text-[var(--color-text-muted)]');
                    advancedToggle.setAttribute('title', 'Advanced Mode: On - Click to hide options');
                    advancedToggle.setAttribute('aria-label', 'Advanced Mode: On');
                } else {
                    advancedToggle.classList.remove('bg-[var(--color-primary)]/20', 'text-[var(--color-primary)]');
                    advancedToggle.classList.add('text-[var(--color-text-muted)]');
                    advancedToggle.setAttribute('title', 'Advanced Mode: Off - Click to show advanced features');
                    advancedToggle.setAttribute('aria-label', 'Advanced Mode: Off');
                }
            }

            const advancedHint = document.getElementById('advanced-hint');
            
            // Progressive disclosure: Advanced mode shows all controls, beginner mode shows minimal
            if (State.advancedMode) {
                // Show all advanced elements
                if (els.proControls) {
                    els.proControls.classList.remove('hidden');
                    els.proControls.style.display = '';
                }
                if (modeToggleContainer) {
                    modeToggleContainer.classList.remove('hidden');
                    modeToggleContainer.style.display = '';
                }
                if (chartDisplayOptions) {
                    chartDisplayOptions.classList.remove('hidden');
                    chartDisplayOptions.style.display = '';
                }
                if (tableOptions) {
                    tableOptions.classList.remove('hidden');
                    tableOptions.style.display = '';
                }
                if (exportMenu) {
                    exportMenu.classList.remove('hidden');
                    exportMenu.style.display = '';
                }
                if (advancedHint) {
                    advancedHint.style.display = 'none';
                }
                advancedModeOptions.forEach(option => option.classList.remove('hidden'));
                // Set mode to pro to show all customization options
                if (State.mode !== 'pro') {
                    App.setMode('pro');
                }
                // Expand all collapsible sections for easy access
                const details = document.querySelectorAll('#pro-controls details');
                details.forEach(detail => detail.setAttribute('open', ''));
            } else {
                // Hide all advanced elements for minimal beginner view
                if (els.proControls) {
                    els.proControls.classList.add('hidden');
                    els.proControls.style.display = 'none';
                }
                if (modeToggleContainer) {
                    modeToggleContainer.classList.add('hidden');
                    modeToggleContainer.style.display = 'none';
                }
                if (chartDisplayOptions) {
                    chartDisplayOptions.classList.add('hidden');
                    chartDisplayOptions.style.display = 'none';
                }
                if (tableOptions) {
                    tableOptions.classList.add('hidden');
                    tableOptions.style.display = 'none';
                }
                if (exportMenu) {
                    exportMenu.classList.add('hidden');
                    exportMenu.style.display = 'none';
                }
                if (advancedHint) {
                    advancedHint.style.display = 'block';
                }
                advancedModeOptions.forEach(option => option.classList.add('hidden'));
                if (State.tradingMode === 'short-sell') {
                    App.setTradingMode('buy-sell');
                }
                // Keep mode as is - don't force simple mode, but hide advanced controls
            }
        },

        bindEvents: () => {
            // Mode Switch
            if (els.modeSimple) els.modeSimple.addEventListener('click', () => App.setMode('simple'));
            if (els.modePro) els.modePro.addEventListener('click', () => App.setMode('pro'));

            // Fees Toggle
            if (els.showFeesToggle) {
                els.showFeesToggle.addEventListener('change', () => {
                    State.showFees = els.showFeesToggle.checked;
                    App.updateUI(State.currentPlanData);
                });
            }

            // Chart Display Toggles
            const chartShowBars = document.getElementById('chart-show-bars');
            const chartShowCumulative = document.getElementById('chart-show-cumulative');
            const chartUnitVolume = document.getElementById('chart-unit-volume');
            const chartUnitValue = document.getElementById('chart-unit-value');

            const redrawChart = () => {
                if (State.currentPlanData) {
                    const s = State.currentPlanData.summary;
                    drawDepthChart('#depth-chart', State.currentPlanData.buyLadder, State.currentPlanData.sellLadder, s?.avgBuy, s?.avgSell);
                }
            };

            if (chartShowBars) {
                chartShowBars.addEventListener('change', () => {
                    State.chartShowBars = chartShowBars.checked;
                    redrawChart();
                });
            }

            if (chartShowCumulative) {
                chartShowCumulative.addEventListener('change', () => {
                    State.chartShowCumulative = chartShowCumulative.checked;
                    redrawChart();
                });
            }

            const updateChartUnitType = (type) => {
                State.chartUnitType = type;
                if (type === 'volume') {
                    chartUnitVolume?.classList.add('active');
                    chartUnitValue?.classList.remove('active');
                } else {
                    chartUnitValue?.classList.add('active');
                    chartUnitVolume?.classList.remove('active');
                }
                redrawChart();
            };

            if (chartUnitVolume) chartUnitVolume.addEventListener('click', () => updateChartUnitType('volume'));
            if (chartUnitValue) chartUnitValue.addEventListener('click', () => updateChartUnitType('value'));

            // How It Works Modal
            const howItWorksModal = document.getElementById('how-it-works-modal');
            const howItWorksVolumeChart = document.getElementById('how-it-works-volume-chart');
            const howItWorksValueChart = document.getElementById('how-it-works-value-chart');
            
            const toggleHowItWorks = (show) => {
                if (!howItWorksModal) return;
                howItWorksModal.classList.toggle('open', show);
                
                // Draw charts when modal opens - match main page style
                if (show && window.drawHowItWorksChart) {
                    setTimeout(() => {
                        if (howItWorksVolumeChart) {
                            // Volume chart - shows quantity
                            window.drawHowItWorksChart('#how-it-works-volume-chart svg', 100, false);
                        }
                        if (howItWorksValueChart) {
                            // Value chart - shows dollar amounts
                            window.drawHowItWorksChart('#how-it-works-value-chart svg', 100, true);
                        }
                    }, 100);
                }
            };
            
            const introHowItWorks = document.getElementById('intro-how-it-works');
            const howItWorksBackdrop = document.getElementById('how-it-works-backdrop');
            const howItWorksClose = document.getElementById('how-it-works-close');
            
            if (introHowItWorks) introHowItWorks.addEventListener('click', () => toggleHowItWorks(true));
            if (howItWorksBackdrop) howItWorksBackdrop.addEventListener('click', () => toggleHowItWorks(false));
            if (howItWorksClose) howItWorksClose.addEventListener('click', () => toggleHowItWorks(false));
            
            // How It Works button in header
            const howItWorksBtn = document.getElementById('how-it-works-btn');
            const howItWorksBtnMobile = document.getElementById('how-it-works-btn-mobile');
            if (howItWorksBtn) howItWorksBtn.addEventListener('click', () => toggleHowItWorks(true));
            if (howItWorksBtnMobile) howItWorksBtnMobile.addEventListener('click', () => toggleHowItWorks(true));

            // Handle Intro Page
            const enterBtn = document.getElementById('enter-app-btn');
            if (enterBtn) {
                enterBtn.addEventListener('click', () => {
                    const wizard = document.getElementById('setup-wizard');
                    if (!wizard) { console.error('Setup wizard not found'); return; }
                    SetupWizard.prepare();
                    wizard.style.opacity = '1';
                    wizard.style.pointerEvents = 'auto';
                    requestAnimationFrame(() => {
                        SetupWizard.show();
                        Utils.setCookie('os_intro_seen', 'true');
                        Utils.hideIntro(document.getElementById('intro-layer'));
                        history.pushState({ introVisible: false }, '');
                    });
                });
            }


            // Skip to Customization Button
            const skipToCustomizeBtn = document.getElementById('skip-to-customize-btn');
            if (skipToCustomizeBtn) {
                skipToCustomizeBtn.addEventListener('click', () => {
                    Utils.setCookie('os_intro_seen', 'true');
                    Utils.hideIntro(document.getElementById('intro-layer'));
                    localStorage.setItem(CONSTANTS.STORAGE_PREFIX + 'setup_completed', 'true');
                    App.setMode('pro');
                    App.calculatePlan();
                    history.pushState({ introVisible: false }, '');
                });
            }

            // Handle Logo Click - Return to Start Page
            const logoHeader = document.getElementById('logo-header');
            if (logoHeader) {
                logoHeader.addEventListener('click', () => {
                    App.returnToWelcome();
                });
            }

            // Handle Start Over Button - Return to Welcome Screen
            const startOverBtn = document.getElementById('start-over-btn');
            if (startOverBtn) {
                startOverBtn.addEventListener('click', () => {
                    App.returnToWelcome();
                });
            }
            

            // Slider Syncs
            const syncSlider = (slider, input, display) => {
                if (!slider || !input) return;
                slider.addEventListener('input', () => {
                    input.value = slider.value;
                    if(display) display.textContent = slider.value;
                    App.debouncedCalc();
                });
                input.addEventListener('input', () => {
                    slider.value = input.value;
                    if(display) display.textContent = input.value;
                    App.debouncedCalc();
                });
            };

            syncSlider(els.rungs, els.rungsInput, els.rungsDisplay);
            syncSlider(els.depth, els.depthInput);
            
            // Skew Sync
            if (els.skew) {
                els.skew.addEventListener('input', () => {
                    if (els.skewLabel) els.skewLabel.textContent = Utils.getSkewLabel(parseInt(els.skew.value));
                    App.debouncedCalc();
                });
            }

            // Format currency inputs with commas
            Utils.bindCurrencyInput(els.startCap, App.debouncedCalc);
            Utils.bindCurrencyInput(els.currPrice, App.debouncedCalc);

            // Standard Inputs
            const inputs = [els.buyFloor, els.sellCeiling, els.existQty, els.existAvg, els.feeValue];
            inputs.forEach(el => { if(el) el.addEventListener('input', App.debouncedCalc); });

            // Fee Type Toggle Buttons
            const feeTypePercent = document.getElementById('fee_type_percent');
            const feeTypeFixed = document.getElementById('fee_type_fixed');
            const feeDollarPrefix = document.getElementById('fee_dollar_prefix');
            if (feeTypePercent && feeTypeFixed) {
                const updateFeeType = (value) => {
                    if (els.feeType) els.feeType.value = value;
                    if (value === 'percent') {
                        feeTypePercent.classList.add('active');
                        feeTypeFixed.classList.remove('active');
                        if (feeDollarPrefix) feeDollarPrefix.classList.add('hidden');
                        if (els.feeValue) els.feeValue.style.paddingLeft = '';
                    } else {
                        feeTypeFixed.classList.add('active');
                        feeTypePercent.classList.remove('active');
                        if (feeDollarPrefix) feeDollarPrefix.classList.remove('hidden');
                        if (els.feeValue) els.feeValue.style.paddingLeft = '2.5rem';
                    }
                    App.calculatePlan();
                };
                feeTypePercent.addEventListener('click', () => updateFeeType('percent'));
                feeTypeFixed.addEventListener('click', () => updateFeeType('fixed'));
                updateFeeType('percent');
            }

            // Selects
            [els.priceRangeMode, els.feeSettlement, els.spacingMode].forEach(el => {
                if(el) el.addEventListener('change', (e) => {
                    if (e.target === els.priceRangeMode) App.togglePriceMode();
                    App.calculatePlan();
                });
            });

            // Mode Selector Dropdown
            const modeSelectorBtn = document.getElementById('mode-selector-btn');
            const modeSelectorDropdown = document.getElementById('mode-selector-dropdown');
            const modeSelectorText = document.getElementById('mode-selector-text');
            const modeSelectorIcon = document.getElementById('mode-selector-icon');
            const modeSelectorChevron = document.getElementById('mode-selector-chevron');
            const modeDropdownOptions = document.querySelectorAll('.mode-dropdown-option');
            const buyModeInputs = document.getElementById('buy-mode-inputs');
            const sellModeInputs = document.getElementById('sell-mode-inputs');
            const currentPriceSell = document.getElementById('current_price_sell');

            const modeConfig = {
                'buy-only': {
                    text: 'Buy Only',
                    icon: '<svg class="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>',
                    iconBg: 'bg-red-500/20',
                    color: 'red'
                },
                'sell-only': {
                    text: 'Sell Only',
                    icon: '<svg class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>',
                    iconBg: 'bg-green-500/20',
                    color: 'green'
                },
                'buy-sell': {
                    text: 'Buy + Sell',
                    icon: '<svg class="w-3.5 h-3.5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path></svg>',
                    iconBg: 'bg-cyan-500/20',
                    color: 'cyan'
                },
                'short-sell': {
                    text: 'Short Sell',
                    icon: '<svg class="w-3.5 h-3.5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v18m0 0l-4-4m4 4l4-4M6 7h12"></path></svg>',
                    iconBg: 'bg-purple-500/20',
                    color: 'purple'
                }
            };

            const toggleDropdown = (open) => {
                if (!modeSelectorDropdown || !modeSelectorBtn || !modeSelectorChevron) return;
                
                if (open) {
                    modeSelectorDropdown.classList.remove('opacity-0', 'invisible', 'translate-y-1');
                    modeSelectorDropdown.classList.add('opacity-100', 'visible', 'translate-y-0');
                    modeSelectorChevron.classList.add('rotate-180');
                    modeSelectorBtn.setAttribute('aria-expanded', 'true');
                } else {
                    modeSelectorDropdown.classList.add('opacity-0', 'invisible', 'translate-y-1');
                    modeSelectorDropdown.classList.remove('opacity-100', 'visible', 'translate-y-0');
                    modeSelectorChevron.classList.remove('rotate-180');
                    modeSelectorBtn.setAttribute('aria-expanded', 'false');
                }
            };

            const setTradingMode = (mode) => {
                State.tradingMode = mode;
                State.sellOnlyMode = mode === 'sell-only';
                State.buyOnlyMode = mode === 'buy-only';
                State.shortSellMode = mode === 'short-sell';
                if (els.sellOnlyCheck) els.sellOnlyCheck.checked = mode === 'sell-only';
                
                // Update label based on mode
                if (els.startCapLabel) {
                    if (mode === 'buy-only') {
                        els.startCapLabel.textContent = 'Initial Capital';
                    } else if (mode === 'sell-only') {
                        els.startCapLabel.textContent = 'Held Quantity';
                    } else if (mode === 'short-sell') {
                        els.startCapLabel.textContent = 'Shorting Capital';
                    } else if (mode === 'buy-sell') {
                        els.startCapLabel.textContent = 'Initial Capital';
                    }
                }
                
                // Update dropdown button
                if (modeSelectorText && modeSelectorIcon) {
                    const config = modeConfig[mode];
                    if (config) {
                        modeSelectorText.textContent = config.text;
                        modeSelectorIcon.className = `w-5 h-5 rounded ${config.iconBg} flex items-center justify-center`;
                        modeSelectorIcon.innerHTML = config.icon;
                    }
                }
                
                // Update dropdown options
                modeDropdownOptions.forEach(option => {
                    const optionMode = option.getAttribute('data-mode');
                    const checkIcon = option.querySelector('svg:last-child');
                    if (optionMode === mode) {
                        option.setAttribute('aria-selected', 'true');
                        if (checkIcon) checkIcon.classList.remove('opacity-0');
                        if (checkIcon) checkIcon.classList.add('opacity-100');
                    } else {
                        option.setAttribute('aria-selected', 'false');
                        if (checkIcon) checkIcon.classList.add('opacity-0');
                        if (checkIcon) checkIcon.classList.remove('opacity-100');
                    }
                });
                
                buyModeInputs?.classList.toggle('hidden', mode === 'sell-only');
                sellModeInputs?.classList.toggle('hidden', mode !== 'sell-only');
                document.body.classList.toggle('sell-mode-active', mode === 'sell-only');
                document.body.classList.toggle('buy-only-mode-active', mode === 'buy-only');
                document.body.classList.toggle('short-sell-mode-active', mode === 'short-sell');
                
                if (mode === 'sell-only') App.switchTab('sell');
                else if (mode === 'buy-only') App.switchTab('buy');
                else if (mode === 'short-sell') App.switchTab('sell');
                else State.sellOnlyHighestExecuted = null;
                
                App.updateModeLabels();
                App.calculatePlan();
            };

            // Expose setTradingMode for wizard
            App.setTradingMode = setTradingMode;

            // Dropdown button click
            if (modeSelectorBtn) {
                modeSelectorBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = modeSelectorDropdown?.classList.contains('opacity-100');
                    toggleDropdown(!isOpen);
                });
            }

            // Dropdown option clicks
            modeDropdownOptions.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const mode = option.getAttribute('data-mode');
                    if (mode) {
                        setTradingMode(mode);
                        toggleDropdown(false);
                    }
                });
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (modeSelectorDropdown && modeSelectorBtn && 
                    !modeSelectorDropdown.contains(e.target) && 
                    !modeSelectorBtn.contains(e.target)) {
                    toggleDropdown(false);
                }
            });

            // Keyboard navigation
            if (modeSelectorBtn) {
                modeSelectorBtn.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const isOpen = modeSelectorDropdown?.classList.contains('opacity-100');
                        toggleDropdown(!isOpen);
                    } else if (e.key === 'Escape') {
                        toggleDropdown(false);
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        toggleDropdown(true);
                        const firstOption = modeDropdownOptions[0];
                        if (firstOption) firstOption.focus();
                    }
                });
            }

            modeDropdownOptions.forEach((option, index) => {
                option.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        option.click();
                    } else if (e.key === 'Escape') {
                        toggleDropdown(false);
                        modeSelectorBtn?.focus();
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = modeDropdownOptions[index + 1];
                        if (next) next.focus();
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (index === 0) {
                            modeSelectorBtn?.focus();
                        } else {
                            const prev = modeDropdownOptions[index - 1];
                            if (prev) prev.focus();
                        }
                    }
                });
            });

            // Initialize with default mode
            setTradingMode(State.tradingMode);
            
            // Sync price inputs between modes
            if (currentPriceSell && els.currPrice) {
                currentPriceSell.addEventListener('input', () => {
                    els.currPrice.value = currentPriceSell.value;
                    App.debouncedCalc();
                });
                els.currPrice.addEventListener('input', () => {
                    currentPriceSell.value = els.currPrice.value;
                });
            }

            // Legacy checkbox handler
            if (els.sellOnlyCheck) {
                els.sellOnlyCheck.addEventListener('change', () => {
                    setTradingMode(els.sellOnlyCheck.checked ? 'sell-only' : 'buy-sell');
                });
            }

            // Tabs & Buttons
            if (els.tabBuy) els.tabBuy.addEventListener('click', () => App.switchTab('buy'));
            if (els.tabSell) els.tabSell.addEventListener('click', () => App.switchTab('sell'));
            if (els.themeBtn) els.themeBtn.addEventListener('click', App.toggleTheme);

            const setupMenuToggle = ({ buttonEl, dropdownEl, itemSelector }) => {
                if (!buttonEl || !dropdownEl) return;

                const openClasses = ['opacity-100', 'visible'];
                const closedClasses = ['opacity-0', 'invisible'];

                const isOpen = () => dropdownEl.classList.contains('opacity-100');

                const open = () => {
                    dropdownEl.classList.remove(...closedClasses);
                    dropdownEl.classList.add(...openClasses);
                    buttonEl.setAttribute('aria-expanded', 'true');
                };

                const close = () => {
                    dropdownEl.classList.remove(...openClasses);
                    dropdownEl.classList.add(...closedClasses);
                    buttonEl.setAttribute('aria-expanded', 'false');
                };

                const toggle = () => {
                    if (isOpen()) {
                        close();
                    } else {
                        open();
                    }
                };

                buttonEl.addEventListener('click', (event) => {
                    event.stopPropagation();
                    toggle();
                });

                document.addEventListener('click', (event) => {
                    if (!dropdownEl.contains(event.target) && !buttonEl.contains(event.target) && isOpen()) {
                        close();
                    }
                });

                if (itemSelector) {
                    dropdownEl.addEventListener('click', (event) => {
                        const item = event.target.closest(itemSelector);
                        if (item && isOpen()) {
                            close();
                        }
                    });
                }
            };

            // Actions Menu Toggle
            const actionsMenuBtn = document.getElementById('actions-menu-btn');
            const actionsMenuDropdown = document.getElementById('actions-menu-dropdown');
            setupMenuToggle({
                buttonEl: actionsMenuBtn,
                dropdownEl: actionsMenuDropdown,
                itemSelector: '[data-menu-close-on-click]',
            });

            // Quick Save Menu Toggle
            const quickSaveMenuBtn = document.getElementById('quick-save-menu-btn');
            const quickSaveMenuDropdown = document.getElementById('quick-save-menu-dropdown');
            setupMenuToggle({
                buttonEl: quickSaveMenuBtn,
                dropdownEl: quickSaveMenuDropdown,
                itemSelector: '[data-menu-close-on-click]',
            });

            // Links Menu Toggle
            const linksMenuBtn = document.getElementById('links-menu-btn');
            const linksMenuDropdown = document.getElementById('links-menu-dropdown');
            setupMenuToggle({
                buttonEl: linksMenuBtn,
                dropdownEl: linksMenuDropdown,
                itemSelector: '[data-menu-close-on-click]',
            });
            
            // Hamburger Menu Toggle
            const menuToggleBtn = document.getElementById('menu-toggle-btn');
            const menuDropdown = document.getElementById('menu-dropdown');
            const menuIcon = document.getElementById('menu-icon');
            const menuCloseIcon = document.getElementById('menu-close-icon');
            
            if (menuToggleBtn && menuDropdown) {
                const toggleMenu = () => {
                    const isOpen = menuDropdown.classList.contains('opacity-100');
                    if (isOpen) {
                        menuDropdown.classList.remove('opacity-100', 'visible');
                        menuDropdown.classList.add('opacity-0', 'invisible');
                        menuIcon.classList.remove('hidden');
                        menuCloseIcon.classList.add('hidden');
                    } else {
                        menuDropdown.classList.remove('opacity-0', 'invisible');
                        menuDropdown.classList.add('opacity-100', 'visible');
                        menuIcon.classList.add('hidden');
                        menuCloseIcon.classList.remove('hidden');
                    }
                };
                
                menuToggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleMenu();
                });
                
                // Close menu when clicking outside
                document.addEventListener('click', (e) => {
                    if (!menuDropdown.contains(e.target) && !menuToggleBtn.contains(e.target)) {
                        if (menuDropdown.classList.contains('opacity-100')) {
                            toggleMenu();
                        }
                    }
                });
                
                // Close menu when clicking on menu items (except theme toggle which needs to stay open)
                const menuItems = menuDropdown.querySelectorAll('a, button');
                menuItems.forEach(item => {
                    if (item.id !== 'theme-toggle-btn' && item.id !== 'sol-btn') {
                        item.addEventListener('click', () => {
                            if (menuDropdown.classList.contains('opacity-100')) {
                                toggleMenu();
                            }
                        });
                    }
                });
            }
            
            // Advanced Mode Toggle
            const advancedModeToggle = document.getElementById('advanced-mode-toggle');
            if (advancedModeToggle) {
                advancedModeToggle.addEventListener('click', App.toggleAdvancedMode);
            }
            
            const downloadBtn = document.getElementById('download-csv-btn');
            const saveConfigBtn = document.getElementById('save-config-btn');
            const loadConfigFile = document.getElementById('load-config-file');
            if (downloadBtn) downloadBtn.addEventListener('click', App.exportCSV);
            if (saveConfigBtn) saveConfigBtn.addEventListener('click', App.saveConfig);
            if (loadConfigFile) loadConfigFile.addEventListener('change', App.loadConfig);

            const quickSaveConfigBtn = document.getElementById('quick-save-config-btn');
            const quickLoadConfigFile = document.getElementById('quick-load-config-file');
            if (quickSaveConfigBtn) quickSaveConfigBtn.addEventListener('click', App.saveConfig);
            if (quickLoadConfigFile) quickLoadConfigFile.addEventListener('change', App.loadConfig);
            
            // QR Modal
            const toggleModal = Utils.bindModal(els.qrModal, [els.solBtn], [els.qrBackdrop, els.qrClose]);

            // Video Modal with lazy loading
            const videoIframe = els.videoModal?.querySelector('iframe');
            const videoSrc = videoIframe?.dataset.src || videoIframe?.src || '';
            const toggleVideo = (show) => {
                els.videoModal?.classList.toggle('open', show);
                if (videoIframe) videoIframe.src = show ? videoSrc : '';
            };
            const introVideoLink = document.getElementById('intro-video-link');
            const openVideo = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                if (els.videoModal) {
                    toggleVideo(true);
                }
            };
            if (els.videoBtn) els.videoBtn.addEventListener('click', openVideo);
            if (els.videoBtnMobile) els.videoBtnMobile.addEventListener('click', openVideo);
            if (introVideoLink) introVideoLink.addEventListener('click', openVideo);
            [els.videoBackdrop, els.videoClose].forEach(el => {
                if (el) {
                    el.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleVideo(false);
                    });
                }
            });

            // Global Escape key handler
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (els.qrModal?.classList.contains('open')) toggleModal(false);
                    if (els.videoModal?.classList.contains('open')) toggleVideo(false);
                    if (howItWorksModal?.classList.contains('open')) toggleHowItWorks(false);
                }
            });

            // Sticky Footer
            if(els.stickyBtn) {
                els.stickyBtn.addEventListener('click', () => {
                    if (els.stickyDetails) els.stickyDetails.classList.toggle('hidden');
                    if (els.stickyChevron) els.stickyChevron.classList.toggle('rotate-180');
                });
            }
            
            // Make helper tooltips clickable
            const helperTooltips = document.querySelectorAll('.helper-tooltip');
            helperTooltips.forEach(tooltipBtn => {
                // Create tooltip content div if it doesn't exist
                if (!tooltipBtn.dataset.tooltipInitialized) {
                    tooltipBtn.dataset.tooltipInitialized = 'true';
                    const title = tooltipBtn.getAttribute('title');
                    if (title) {
                        tooltipBtn.removeAttribute('title'); // Remove native tooltip
                        
                        const tooltipContent = document.createElement('div');
                        tooltipContent.className = 'helper-tooltip-popup hidden absolute z-50 mt-2 p-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg text-xs text-[var(--color-text-secondary)] max-w-xs';
                        tooltipContent.textContent = title;
                        tooltipBtn.parentElement.style.position = 'relative';
                        tooltipBtn.parentElement.appendChild(tooltipContent);
                        
                        tooltipBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const isHidden = tooltipContent.classList.contains('hidden');
                            // Close all other tooltips
                            document.querySelectorAll('.helper-tooltip-popup').forEach(t => {
                                if (t !== tooltipContent) t.classList.add('hidden');
                            });
                            tooltipContent.classList.toggle('hidden', !isHidden);
                        });
                    }
                }
            });
            
            // Close tooltips when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.helper-tooltip') && !e.target.closest('.helper-tooltip-popup')) {
                    document.querySelectorAll('.helper-tooltip-popup').forEach(tooltip => {
                        tooltip.classList.add('hidden');
                    });
                }
            });
        },

        debouncedCalc: () => Utils.debounce(App.calculatePlan, 50)(),

        setMode: (mode) => {
            State.mode = mode;
            const activeClass = "shadow-sm bg-[var(--color-card)] text-[var(--color-primary)]";
            const inactiveClass = "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]";
            
            if (els.modeSimple) els.modeSimple.className = `px-3 py-1 text-xs font-medium rounded-md transition-all ${mode==='simple'?activeClass:inactiveClass}`;
            if (els.modePro) els.modePro.className = `px-3 py-1 text-xs font-medium rounded-md transition-all ${mode==='pro'?activeClass:inactiveClass}`;
            
            // Pro controls visibility is handled by applyAdvancedMode
            // Only toggle here if advanced mode is on
            if (State.advancedMode && els.proControls) {
                els.proControls.classList.toggle('hidden', mode === 'simple');
                els.proControls.style.display = mode === 'simple' ? 'none' : '';
            }
            
            const mainGrid = document.getElementById('main-content-grid');
            const configColumn = document.getElementById('config-column');
            const graphColumn = document.getElementById('graph-column');
            
            // Layout: Always use two columns on desktop (lg) to fill space; single column on mobile
            if (mainGrid) mainGrid.className = 'grid grid-cols-1 lg:grid-cols-12 gap-6';
            if (configColumn) configColumn.className = 'lg:col-span-5 space-y-6 min-w-0';
            if (graphColumn) graphColumn.className = 'lg:col-span-7 space-y-6 min-w-0';
            
            App.calculatePlan();
        },

        togglePriceMode: () => {
            if (!els.priceRangeMode) return;
            const mode = els.priceRangeMode.value;
            els.widthContainer?.classList.toggle('hidden', mode !== 'width');
            els.floorContainer?.classList.toggle('hidden', mode !== 'floor');
        },

        switchTab: (tab) => {
            State.activeTab = tab;
            const activeClass = "flex-1 py-3 text-sm font-medium text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] bg-[var(--color-card-alt)]";
            const inactiveClass = "flex-1 py-3 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]";
            
            if (els.tabBuy) els.tabBuy.className = tab === 'buy' ? activeClass : inactiveClass;
            if (els.tabSell) els.tabSell.className = tab === 'sell' ? activeClass : inactiveClass;
            els.panelBuy?.classList.toggle('hidden', tab !== 'buy');
            els.panelSell?.classList.toggle('hidden', tab !== 'sell');
        },

        updateModeLabels: () => {
            const isShortSell = State.tradingMode === 'short-sell';
            const buyLabel = isShortSell ? 'Cover Orders' : 'Buy Orders';
            const sellLabel = isShortSell ? 'Short Sell Orders' : 'Sell Orders';

            const tabBuyLabel = document.getElementById('tab-buy-label');
            const tabSellLabel = document.getElementById('tab-sell-label');
            if (tabBuyLabel) tabBuyLabel.textContent = buyLabel;
            if (tabSellLabel) tabSellLabel.textContent = sellLabel;

            const legendBuy = document.getElementById('legend-buy-label');
            const legendSell = document.getElementById('legend-sell-label');
            if (legendBuy) legendBuy.textContent = isShortSell ? 'Cover (orders)' : 'Buy (orders)';
            if (legendSell) legendSell.textContent = isShortSell ? 'Short (orders)' : 'Sell (orders)';

            const labelBuySide = document.getElementById('label-buy-side');
            const labelSellSide = document.getElementById('label-sell-side');
            if (labelBuySide) labelBuySide.textContent = isShortSell ? 'Cover Side' : 'Buy Side';
            if (labelSellSide) labelSellSide.textContent = isShortSell ? 'Short Side' : 'Sell Side';

            const labelAvgBuy = document.getElementById('label-avg-buy');
            const labelAvgSell = document.getElementById('label-avg-sell');
            const stickyLabelAvgBuy = document.getElementById('sticky-label-avg-buy');
            const stickyLabelAvgSell = document.getElementById('sticky-label-avg-sell');
            if (labelAvgBuy) labelAvgBuy.textContent = isShortSell ? 'Avg Cover' : 'Avg Buy';
            if (labelAvgSell) labelAvgSell.textContent = isShortSell ? 'Avg Short' : 'Avg Sell';
            if (stickyLabelAvgBuy) stickyLabelAvgBuy.textContent = isShortSell ? 'Avg Cover:' : 'Avg Buy:';
            if (stickyLabelAvgSell) stickyLabelAvgSell.textContent = isShortSell ? 'Avg Short:' : 'Avg Sell:';

            const buyTableLastCol = document.getElementById('buy-table-last-col');
            const sellTableLastCol = document.getElementById('sell-table-last-col');
            if (buyTableLastCol) buyTableLastCol.textContent = isShortSell ? 'Avg Cover' : 'Avg Price';
            if (sellTableLastCol) sellTableLastCol.textContent = 'Profit';
        },

        // --- CORE CALCULATION ---
        calculatePlan: () => {
            const C = parseFloat(Utils.stripCommas(els.startCap?.value)) || 0;
            const currentPrice = parseFloat(Utils.stripCommas(els.currPrice?.value)) || 0;
            const isShortSell = State.tradingMode === 'short-sell';
            
            let N, S, depth, feeType, feeValue, feeSettlement, spacingMode, sellOnly, buyOnly;

            if (State.mode === 'simple') {
                N = 10;
                S = 50;
                depth = 25;
                feeType = 'percent';
                feeValue = 0.075;
                feeSettlement = 'netted';
                spacingMode = 'absolute';
                sellOnly = false;
                buyOnly = false;
            } else {
                N = parseInt(els.rungs?.value) || 2;
                S = parseInt(els.skew?.value) || 0;
                depth = parseFloat(els.depth?.value) || 20;
                feeType = els.feeType?.value || 'percent';
                feeValue = parseFloat(els.feeValue?.value) || 0;
                feeSettlement = els.feeSettlement?.value || 'netted';
                spacingMode = els.spacingMode?.value || 'absolute';
                sellOnly = els.sellOnlyCheck?.checked || false;
                buyOnly = State.buyOnlyMode || false;
            }

            if (isShortSell) {
                sellOnly = false;
                buyOnly = false;
            }

            const feeRate = feeType === 'percent' ? feeValue / 100 : 0;
            const isFeeNetted = feeSettlement !== 'external';
            const hasValidCurrentPrice = Number.isFinite(currentPrice) && currentPrice > 0;
            const isRelativeSpacing = spacingMode === 'relative' && hasValidCurrentPrice;

            let buyPriceEnd, sellPriceEnd;
            const useFloor = State.mode === 'pro' && els.priceRangeMode?.value === 'floor';
            
            if (useFloor) {
                const buyFloorValue = parseFloat(els.buyFloor?.value);
                buyPriceEnd = !isNaN(buyFloorValue) ? buyFloorValue : currentPrice * 0.8;
                
                const sellCeilingValue = parseFloat(els.sellCeiling?.value);
                sellPriceEnd = !isNaN(sellCeilingValue) ? sellCeilingValue : currentPrice * 1.2;
            } else {
                buyPriceEnd = currentPrice * (1 - depth/100);
                sellPriceEnd = currentPrice * (1 + depth/100);
            }

            const rungDivisor = N > 0 ? N : 1;
            const buyStep = (!isRelativeSpacing && N > 0) ? (currentPrice - buyPriceEnd) / rungDivisor : 0;
            const sellStep = (!isRelativeSpacing && N > 0) ? (sellPriceEnd - currentPrice) / rungDivisor : 0;
            const buyRatio = (isRelativeSpacing && N > 0) ? Math.pow(Math.max(buyPriceEnd/currentPrice, 0), 1/rungDivisor) : 1;
            const sellRatio = (isRelativeSpacing && N > 0) ? Math.pow(sellPriceEnd/currentPrice, 1/rungDivisor) : 1;

            let buyPrices = Array.from({length: N}, (_, i) => isRelativeSpacing ? currentPrice * Math.pow(buyRatio, i + 0.5) : currentPrice - ((i + 0.5) * buyStep));
            let sellPrices = Array.from({length: N}, (_, i) => isRelativeSpacing ? currentPrice * Math.pow(sellRatio, i + 0.5) : currentPrice + ((i + 0.5) * sellStep));
            
            // Leave range endpoints as boundaries (no orders placed exactly at the edges)
            const baseSkewWeights = Calculator.integrateSkewWeights(N, S);
            const targetAvgBuy = Calculator.computeTargetAvgBuy({
                skewValue: S,
                currentPrice,
                buyPriceEnd,
                spacingMode: isRelativeSpacing ? 'relative' : 'absolute'
            });
            const adjustedBuyWeights = Calculator.adjustWeightsToTargetAvg(baseSkewWeights, buyPrices, targetAvgBuy);
            const buyWeightsTotal = adjustedBuyWeights.reduce((a, b) => a + b, 0);
            const sellWeightsTotal = baseSkewWeights.reduce((a, b) => a + b, 0);

            let buyLadder = [];
            let sellLadder = [];
            let totalAssetBought = 0;
            let totalNetCapitalSpent = 0;
            let totalBuyFees = 0;
            let totalSellRev = 0;
            let totalSellFees = 0;
            let effectiveAsset = 0;
            let effectiveSpent = 0;
            let effectiveFees = 0;
            let avgBuyPrice = 0;
            let avgSell = 0;

            if (isShortSell) {
                const buildShortSellLadder = () => {
                    const ladder = [];
                    const rawWeights = baseSkewWeights;
                    const totalWeight = sellWeightsTotal;

                    sellPrices.forEach((price, i) => {
                        const grossRev = totalWeight > 0 ? (C * rawWeights[i]) / totalWeight : 0;
                        let fee = 0;
                        if (grossRev > 0 && feeValue > 0) {
                            fee = feeType === 'percent' ? grossRev * feeRate : feeValue;
                            fee = isFeeNetted ? Math.min(fee, grossRev) : fee;
                        }
                        const netRev = isFeeNetted ? Math.max(grossRev - fee, 0) : grossRev;
                        const assetSize = price > 0 ? grossRev / price : 0;

                        totalAssetBought += assetSize;
                        totalSellRev += netRev;
                        totalSellFees += fee;
                        ladder.push({ rung: i + 1, price, assetSize, capital: grossRev, fee, netRevenue: netRev });
                    });

                    return ladder;
                };

                sellLadder = buildShortSellLadder();

                buyLadder = sellLadder.map((rung, i) => {
                    const price = buyPrices[i];
                    const assetSize = rung.assetSize;
                    const netCapital = assetSize * price;
                    let fee = 0;
                    if (assetSize > 0 && feeValue > 0) {
                        fee = feeType === 'percent' ? netCapital * feeRate : feeValue;
                        if (feeType !== 'percent') fee = Math.min(fee, netCapital);
                    }
                    totalNetCapitalSpent += netCapital;
                    totalBuyFees += fee;
                    return { rung: i + 1, price, capital: netCapital + fee, netCapital, assetSize, fee };
                });

                let cumNet = 0;
                let cumAsset = 0;
                buyLadder.forEach(r => {
                    cumNet += r.netCapital + r.fee;
                    cumAsset += r.assetSize;
                    r.avg = cumAsset > 0 ? cumNet / cumAsset : 0;
                    r.cumQty = cumAsset;
                });

                effectiveAsset = totalAssetBought;
                effectiveSpent = totalNetCapitalSpent + totalBuyFees;
                effectiveFees = totalBuyFees;

                avgBuyPrice = effectiveAsset > 0 ? effectiveSpent / effectiveAsset : 0;
                avgSell = effectiveAsset > 0 ? totalSellRev / effectiveAsset : 0;

                let cumSold = 0;
                let cumProfit = 0;
                sellLadder = sellLadder.map(r => {
                    const costBasis = avgBuyPrice * r.assetSize;
                    const profit = r.netRevenue - costBasis;
                    cumSold += r.assetSize;
                    cumProfit += profit;
                    return { ...r, profit, cumSold, cumProfit };
                });
            } else {
                const reuseSnapshot = sellOnly && State.baselineBuySnapshot && State.baselineBuySnapshot.buyLadder.length > 0;

                if (reuseSnapshot) {
                    buyLadder = State.baselineBuySnapshot.buyLadder.map(r => ({...r}));
                    totalAssetBought = State.baselineBuySnapshot.totalAssetBought;
                    totalNetCapitalSpent = State.baselineBuySnapshot.totalNetCapitalSpent;
                    totalBuyFees = State.baselineBuySnapshot.totalBuyFees;
                } else {
                    const rawWeights = buyWeightsTotal > 0 ? adjustedBuyWeights : baseSkewWeights;
                    const totalWeight = rawWeights.reduce((a, b) => a + b, 0);
                    
                    buyLadder = rawWeights.map((w, i) => {
                        const alloc = (totalWeight > 0) ? (C * w) / totalWeight : 0;
                        const price = buyPrices[i];
                        let net = alloc, fee = 0, gross = alloc;

                        if (feeValue > 0) {
                            if (isFeeNetted) {
                                if (feeType === 'percent') { net = alloc / (1+feeRate); fee = alloc - net; }
                                else { fee = Math.min(feeValue, alloc); net = alloc - fee; }
                                gross = alloc;
                            } else {
                                fee = feeType === 'percent' ? alloc * feeRate : (alloc > 0 ? feeValue : 0);
                                gross = alloc + fee;
                                net = alloc;
                            }
                        }
                        const assetSize = (price > 0 && net > 0) ? net / price : 0;
                        totalAssetBought += assetSize;
                        totalNetCapitalSpent += net;
                        totalBuyFees += fee;
                        return { rung: i+1, price, capital: gross, netCapital: net, assetSize, fee };
                    });
                }

                let cumNet = 0, cumAsset = 0;
                buyLadder.forEach(r => {
                    cumNet += r.netCapital; cumAsset += r.assetSize;
                    r.avg = cumAsset > 0 ? cumNet / cumAsset : 0;
                    r.cumQty = cumAsset;
                });

                effectiveAsset = totalAssetBought;
                effectiveSpent = totalNetCapitalSpent;
                effectiveFees = totalBuyFees;

                if (sellOnly) {
                    const exQty = parseFloat(els.existQty?.value || 0);
                    const exAvg = parseFloat(els.existAvg?.value || 0);
                    
                    if (State.sellOnlyHighestExecuted !== null) {
                        const dt = Calculator.deriveExecutedBuyTotals(buyLadder, State.sellOnlyHighestExecuted);
                        if (dt.quantity > 0) {
                            effectiveAsset = dt.quantity;
                            effectiveSpent = dt.netCapital;
                            effectiveFees = dt.fees;
                        }
                    } else if (exQty > 0) {
                        effectiveAsset = exQty;
                        effectiveSpent = exQty * exAvg;
                        effectiveFees = 0;
                    }
                }

                const ladderAvgBuy = effectiveAsset > 0 ? effectiveSpent / effectiveAsset : 0;
                avgBuyPrice = !reuseSnapshot && Number.isFinite(targetAvgBuy) && targetAvgBuy > 0 ? targetAvgBuy : ladderAvgBuy;
                let assetAllocations = [];
                if (sellOnly && effectiveAsset <= 0) {
                    assetAllocations = Array(N).fill(0);
                } else if (sellOnly) {
                     const tw = sellWeightsTotal;
                     assetAllocations = tw > 0 ? baseSkewWeights.map(val => (effectiveAsset * val) / tw) : Array(N).fill(0);
                } else {
                     assetAllocations = buyLadder.map(r => r.assetSize);
                }

                let cumSold = 0;
                let cumProfit = 0;
                
                sellLadder = assetAllocations.map((qty, i) => {
                    const price = sellPrices[i];
                    const grossRev = qty * price;
                    let netRev = grossRev, fee = 0;

                    if (feeValue > 0) {
                         const rawFee = feeType === 'percent' ? grossRev * feeRate : (grossRev > 0 ? feeValue : 0);
                         fee = isFeeNetted ? Math.min(rawFee, grossRev) : rawFee;
                         netRev = isFeeNetted ? Math.max(grossRev - fee, 0) : grossRev;
                    }

                    const costBasis = avgBuyPrice * qty;
                    const profit = netRev - costBasis;
                    
                    totalSellRev += netRev;
                    totalSellFees += fee;
                    
                    cumSold += qty;
                    cumProfit += profit;

                    return { rung: i+1, price, assetSize: qty, capital: grossRev, fee, netRevenue: netRev, profit, cumSold, cumProfit };
                });

                avgSell = effectiveAsset > 0 ? totalSellRev / effectiveAsset : 0;
            }

            const totalFees = isShortSell ? (totalBuyFees + totalSellFees) : (sellOnly ? effectiveFees : totalBuyFees) + totalSellFees;
            const finalCostBasis = isShortSell ? (totalNetCapitalSpent + totalBuyFees) : (sellOnly ? effectiveSpent : (totalNetCapitalSpent + totalBuyFees));
            const netProfit = buyOnly ? 0 : (totalSellRev - finalCostBasis - (isFeeNetted ? 0 : totalSellFees));
            const roi = finalCostBasis > 0 && !buyOnly ? (netProfit / finalCostBasis) * 100 : 0;
            const avgSellValue = isShortSell ? avgSell : (effectiveAsset > 0 ? totalSellRev / effectiveAsset : 0);

            const rangeLow = Number.isFinite(buyPriceEnd) ? buyPriceEnd : 0;
            const rangeHigh = Number.isFinite(sellPriceEnd) ? sellPriceEnd : 0;

            // Calculate subtotals
            const buyTotalValue = buyLadder.reduce((sum, r) => sum + r.netCapital, 0);
            const buyTotalVolume = buyLadder.reduce((sum, r) => sum + r.assetSize, 0);
            const sellTotalValue = sellLadder.reduce((sum, r) => sum + r.netRevenue, 0);
            const sellTotalVolume = sellLadder.reduce((sum, r) => sum + r.assetSize, 0);

            State.currentPlanData = { 
                buyLadder, 
                sellLadder, 
                summary: { 
                    netProfit, 
                    roi, 
                    avgBuy: avgBuyPrice, 
                    avgSell: avgSellValue, 
                    totalFees, 
                    totalQuantity: effectiveAsset, 
                    rangeLow,
                    rangeHigh,
                    buyTotalValue,
                    buyTotalVolume,
                    sellTotalValue,
                    sellTotalVolume
                } 
            };
            
            if (!sellOnly && !isShortSell && buyLadder.length > 0) {
                State.baselineBuySnapshot = { buyLadder: [...buyLadder], totalAssetBought, totalNetCapitalSpent, totalBuyFees };
            }
            App.updateUI(State.currentPlanData);
        },

        updateUI: (plan) => {
            if (!plan) return;
            const s = plan.summary;
            const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            const setCls = (id, cls) => { const el = document.getElementById(id); if(el) el.className = cls; };
            
            const summaryMap = {
                'chart-summary-net-profit': Utils.fmtCurr(s.netProfit), 
                'chart-summary-roi': Utils.fmtPct(s.roi),
                'chart-summary-avg-buy': Utils.fmtCurr(s.avgBuy), 
                'chart-summary-avg-sell': Utils.fmtCurr(s.avgSell),
                'chart-summary-total-fees': Utils.fmtCurr(s.totalFees), 
                'chart-summary-total-quantity': Utils.fmtNum(s.totalQuantity),
                'chart-summary-buy-value': Utils.fmtCurr(s.buyTotalValue),
                'chart-summary-buy-volume': Utils.fmtNum(s.buyTotalVolume),
                'chart-summary-sell-value': Utils.fmtCurr(s.sellTotalValue),
                'chart-summary-sell-volume': Utils.fmtNum(s.sellTotalVolume),
                'sticky-net-profit': Utils.fmtCurr(s.netProfit), 
                'sticky-roi': Utils.fmtPct(s.roi),
                'sticky-avg-buy': Utils.fmtCurr(s.avgBuy), 
                'sticky-avg-sell': Utils.fmtCurr(s.avgSell),
                'sticky-fees': Utils.fmtCurr(s.totalFees), 
                'sticky-vol': Utils.fmtNum(s.totalQuantity),
                'sticky-floor': Utils.fmtCurr(s.rangeLow), 
                'sticky-ceiling': Utils.fmtCurr(s.rangeHigh)
            };
            Object.entries(summaryMap).forEach(([id, val]) => setTxt(id, val));
            setCls('chart-summary-net-profit', `text-lg font-bold ${s.netProfit >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-invalid)]'}`);
            setCls('chart-summary-roi', `text-lg font-bold ${s.roi >= 0 ? 'text-green-600' : 'text-red-500'}`);
            els.stickyFooter?.classList.add('visible');

            document.querySelectorAll('.fee-col').forEach(el => el.classList.toggle('hidden', !State.showFees));

            const renderRow = (r, isSell) => {
                const showExecuted = els.sellOnlyCheck?.checked;
                return `
                <td class="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">${isSell || !showExecuted ? '' : `<input type="checkbox" class="mr-2" ${State.sellOnlyHighestExecuted===r.rung?'checked':''} onclick="App.toggleExecuted(${r.rung})">`}${r.rung}</td>
                <td class="px-4 py-3 text-right font-mono copy-cursor hover:bg-[var(--color-border)] transition-colors" onclick="App.copy('${r.price}')">${Utils.fmtSigFig(r.price)}</td>
                <td class="px-4 py-3 text-right font-mono text-[var(--color-text)] copy-cursor hover:bg-[var(--color-border)] transition-colors" onclick="App.copy('${r.assetSize}')">${Utils.fmtSigFig(r.assetSize)}</td>
                <td class="px-4 py-3 text-right font-mono text-[var(--color-text-muted)]">${Utils.fmtSigFig(r.capital)}</td>
                ${State.showFees ? `<td class="px-4 py-3 text-right font-mono text-[var(--color-text-muted)]">${Utils.fmtSigFig(r.fee)}</td>` : ''}
                <td class="px-4 py-3 text-right font-mono font-medium ${isSell ? 'text-green-600' : 'text-[var(--color-text-secondary)]'}">
                    ${Utils.fmtSigFig(isSell ? r.profit : r.avg)}
                </td>
            `;
            };

            const updateTable = (id, data, isSell) => {
                const tbody = document.getElementById(id);
                if (!tbody) return;
                const spacerHeight = 'h-8';
                const colSpan = State.showFees ? 6 : 5;
                const spacerRow = `<tr><td colspan="${colSpan}" class="${spacerHeight}"></td></tr>`;
                tbody.innerHTML = data.map((r, i) => 
                    `<tr class="${i%2===0?'table-row-even':'table-row-odd'} ${State.sellOnlyHighestExecuted>=r.rung && !isSell && els.sellOnlyCheck?.checked ? 'executed-rung' : ''}">
                        ${renderRow(r, isSell)}
                     </tr>`
                ).join('') + spacerRow;
            };
            updateTable('buy-ladder-body', plan.buyLadder, false);
            updateTable('sell-ladder-body', plan.sellLadder, true);

            if (typeof drawDepthChart === 'function') {
                drawDepthChart('#depth-chart', plan.buyLadder, plan.sellLadder, s.avgBuy, s.avgSell);
            }
            
            setTimeout(() => App.ensureTableBottomSpace(), 100);
        },

        toggleExecuted: (rung) => {
            if(!els.sellOnlyCheck?.checked) return;
            window.App.toggleExecutedGlobal(rung);
        },

        copy: (val) => {
            Utils.copyToClipboard(val);
        },
        
        exportCSV: () => {
            if (!State.currentPlanData) return;
            const p = State.currentPlanData;
            const isShortSell = State.tradingMode === 'short-sell';
            const buyLabel = isShortSell ? 'Cover' : 'Buy';
            const sellLabel = isShortSell ? 'Short' : 'Sell';
            const rows = [
                ['Type', 'Rung', 'Price', 'Size', 'Value', 'Profit/Avg'],
                ...p.buyLadder.map(r => [buyLabel, r.rung, r.price, r.assetSize, r.capital, r.avg]),
                ...p.sellLadder.map(r => [sellLabel, r.rung, r.price, r.assetSize, r.capital, r.profit])
            ];
            const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csvContent));
            link.setAttribute("download", "orderskew_plan.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },
        
        saveConfig: () => {
            const config = {
                startingCapital: Utils.stripCommas(els.startCap?.value),
                numberOfRungs: els.rungs?.value,
                skewValue: els.skew?.value,
                depth: els.depth?.value
            };
            const blob = new Blob([JSON.stringify(config)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'orderskew_config.json'; a.click();
        },

        loadConfig: (e) => {
            const file = e.target?.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const c = JSON.parse(ev.target.result);
                    if (c.startingCapital && els.startCap) {
                        els.startCap.value = Utils.formatNumberWithCommas(c.startingCapital);
                        if (els.rungs) els.rungs.value = c.numberOfRungs;
                        if (els.skew) els.skew.value = c.skewValue;
                        if (els.depth) els.depth.value = c.depth;
                        els.rungs?.dispatchEvent(new Event('input'));
                        els.skew?.dispatchEvent(new Event('input'));
                        els.depth?.dispatchEvent(new Event('input'));
                        els.startCap?.dispatchEvent(new Event('input'));
                    }
                } catch(err) { alert('Invalid Config'); }
            };
            reader.readAsText(file);
        },
        
        handleBackNavigation: () => {
            const introLayer = document.getElementById('intro-layer');
            if (!introLayer) return;
            
            // Check if we're on main screen (intro hidden)
            const isMainScreen = introLayer.style.display === 'none' || 
                (introLayer.style.opacity === '0' && introLayer.style.pointerEvents === 'none');
            
            // Check if any modal/wizard is open
            const wizard = document.getElementById('setup-wizard');
            const howItWorksModal = document.getElementById('how-it-works-modal');
            const videoModal = document.getElementById('video-modal');
            const qrModal = document.getElementById('qr-modal');
            
            const hasOpenModal = (wizard && wizard.classList.contains('open')) ||
                (howItWorksModal && howItWorksModal.classList.contains('open')) ||
                (videoModal && videoModal.classList.contains('open')) ||
                (qrModal && qrModal.classList.contains('open'));
            
            // If modal is open, just close it
            if (hasOpenModal) {
                if (wizard && wizard.classList.contains('open')) {
                    wizard.classList.remove('open');
                    wizard.style.opacity = '0';
                    wizard.style.pointerEvents = 'none';
                }
                if (howItWorksModal && howItWorksModal.classList.contains('open')) {
                    howItWorksModal.classList.remove('open');
                }
                if (videoModal && videoModal.classList.contains('open')) {
                    videoModal.classList.remove('open');
                }
                if (qrModal && qrModal.classList.contains('open')) {
                    qrModal.classList.remove('open');
                }
                // Push state to prevent going back further
                history.pushState({ introVisible: !isMainScreen }, '');
                return;
            }
            
            // If on main screen, show confirmation
            if (isMainScreen) {
                const shouldLeave = confirm('Leave and return to welcome screen?\n\nClick OK to continue, or Cancel to stay.');
                if (!shouldLeave) {
                    // User cancelled, push state to prevent going back
                    history.pushState({ introVisible: false }, '');
                    return;
                }
                
                // Offer to save
                if (State.currentPlanData) {
                    const saveNow = confirm('Save your current plan before leaving?');
                    if (saveNow) {
                        App.saveConfig();
                    }
                }
            }
            
            // Return to welcome screen
            introLayer.style.display = 'flex';
            introLayer.style.opacity = '1';
            introLayer.style.pointerEvents = 'auto';
            history.replaceState({ introVisible: true }, '');
        },
        
        returnToWelcome: (fromBackButton = false) => {
            const introLayer = document.getElementById('intro-layer');
            if (!introLayer) return;
            
            // Check if we're on main screen
            const isMainScreen = introLayer.style.display === 'none' || 
                (introLayer.style.opacity === '0' && introLayer.style.pointerEvents === 'none');
            
            if (isMainScreen && !fromBackButton) {
                // Show confirmation dialog with save option
                const shouldSave = confirm('Leave and return to welcome screen?\n\nClick OK to continue, or Cancel to stay.');
                if (!shouldSave) {
                    return;
                }
                
                // Offer to save config
                if (State.currentPlanData) {
                    const saveNow = confirm('Save your current plan before leaving?');
                    if (saveNow) {
                        App.saveConfig();
                    }
                }
            }
            
            // Close any open modals/wizard
            const wizard = document.getElementById('setup-wizard');
            const howItWorksModal = document.getElementById('how-it-works-modal');
            const videoModal = document.getElementById('video-modal');
            const qrModal = document.getElementById('qr-modal');
            
            if (wizard && wizard.classList.contains('open')) {
                wizard.classList.remove('open');
                wizard.style.opacity = '0';
                wizard.style.pointerEvents = 'none';
            }
            if (howItWorksModal && howItWorksModal.classList.contains('open')) {
                howItWorksModal.classList.remove('open');
            }
            if (videoModal && videoModal.classList.contains('open')) {
                videoModal.classList.remove('open');
            }
            if (qrModal && qrModal.classList.contains('open')) {
                qrModal.classList.remove('open');
            }
            
            // Show welcome screen
            introLayer.style.display = 'flex';
            introLayer.style.opacity = '1';
            introLayer.style.pointerEvents = 'auto';
            history.replaceState({ introVisible: true }, '');
        }
    };

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
