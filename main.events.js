// OrderSkew module: attachEventMethods
(function () {
    window.OrderSkewModules = window.OrderSkewModules || {};

    window.OrderSkewModules.attachEventMethods = (App, els) => {
        Object.assign(App, {
        bindEvents: () => {
            const menuCloseRegistry = [];
            const closeAllMenusExcept = (keepOpenFn) => {
                menuCloseRegistry.forEach((closeFn) => {
                    if (closeFn !== keepOpenFn) closeFn();
                });
            };

            if (window.OrderSkewBindChartEvents) window.OrderSkewBindChartEvents(App, els);
            if (window.OrderSkewBindIntroEvents) window.OrderSkewBindIntroEvents(App, els);

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

            // Copy decimal places
            if (els.copyDecimalPlaces) {
                els.copyDecimalPlaces.addEventListener('input', () => {
                    const v = parseInt(els.copyDecimalPlaces.value, 10);
                    State.copyDecimalPlaces = Number.isFinite(v) ? Math.min(CONSTANTS.MAX_COPY_DECIMALS, Math.max(0, v)) : CONSTANTS.MAX_COPY_DECIMALS;
                    els.copyDecimalPlaces.value = State.copyDecimalPlaces;
                    localStorage.setItem(CONSTANTS.STORAGE_PREFIX + 'copy_decimal_places', String(State.copyDecimalPlaces));
                    if (State.currentPlanData) {
                        App.updateUI(State.currentPlanData);
                        App.redrawChart();
                    }
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
                if(display) display.textContent = slider.value;
            };

            syncSlider(els.rungs, els.rungsInput, els.rungsDisplay);
            syncSlider(els.depth, els.depthInput, els.depthDisplayLabel);
            
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
            Utils.bindCurrencyInput(els.currPriceSell, App.debouncedCalc);

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

            // Spacing Mode Toggle Buttons
            const spacingModeAbsolute = document.getElementById('spacing_mode_absolute');
            const spacingModeRelative = document.getElementById('spacing_mode_relative');
            const updateSpacingModeUI = (value) => {
                if (spacingModeAbsolute) spacingModeAbsolute.classList.toggle('active', value === 'absolute');
                if (spacingModeRelative) spacingModeRelative.classList.toggle('active', value === 'relative');
            };
            if (spacingModeAbsolute) spacingModeAbsolute.addEventListener('click', () => {
                if (els.spacingMode) { els.spacingMode.value = 'absolute'; els.spacingMode.dispatchEvent(new Event('change')); }
            });
            if (spacingModeRelative) spacingModeRelative.addEventListener('click', () => {
                if (els.spacingMode) { els.spacingMode.value = 'relative'; els.spacingMode.dispatchEvent(new Event('change')); }
            });
            updateSpacingModeUI(els.spacingMode?.value || 'absolute');

            // Range Type Toggle Buttons
            const priceRangeWidth = document.getElementById('price_range_width');
            const priceRangeFloor = document.getElementById('price_range_floor');
            const updateRangeTypeUI = (value) => {
                if (priceRangeWidth) priceRangeWidth.classList.toggle('active', value === 'width');
                if (priceRangeFloor) priceRangeFloor.classList.toggle('active', value === 'floor');
            };
            if (priceRangeWidth) priceRangeWidth.addEventListener('click', () => {
                if (els.priceRangeMode) { els.priceRangeMode.value = 'width'; els.priceRangeMode.dispatchEvent(new Event('change')); }
            });
            if (priceRangeFloor) priceRangeFloor.addEventListener('click', () => {
                if (els.priceRangeMode) { els.priceRangeMode.value = 'floor'; els.priceRangeMode.dispatchEvent(new Event('change')); }
            });
            updateRangeTypeUI(els.priceRangeMode?.value || 'floor');

            // Selects
            [els.priceRangeMode, els.feeSettlement, els.spacingMode].forEach(el => {
                if(el) el.addEventListener('change', (e) => {
                    if (e.target === els.priceRangeMode) {
                        App.togglePriceMode();
                        updateRangeTypeUI(els.priceRangeMode.value);
                    }
                    if (e.target === els.spacingMode) updateSpacingModeUI(els.spacingMode.value);
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
                if (els.sellOnlyCheck) els.sellOnlyCheck.checked = mode === 'sell-only';
                
                // Update label based on mode
                if (els.startCapLabel) {
                    if (mode === 'buy-only') {
                        els.startCapLabel.textContent = 'Initial Capital';
                    } else if (mode === 'sell-only') {
                        els.startCapLabel.textContent = 'Held Quantity';
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
                
                if (mode === 'sell-only') App.switchTab('sell');
                else if (mode === 'buy-only') App.switchTab('buy');
                else State.sellOnlyHighestExecuted = null;
                
                App.updateModeLabels();
                App.calculatePlan();
            };

            // Expose setTradingMode for wizard
            App.setTradingMode = setTradingMode;

            // Dropdown button click and keyboard - close other menus when opening mode selector
            if (modeSelectorBtn) {
                const modeSelectorClose = () => toggleDropdown(false);
                menuCloseRegistry.push(modeSelectorClose);
                modeSelectorBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = modeSelectorDropdown?.classList.contains('opacity-100');
                    if (!isOpen) closeAllMenusExcept(modeSelectorClose);
                    toggleDropdown(!isOpen);
                });
                modeSelectorBtn.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const isOpen = modeSelectorDropdown?.classList.contains('opacity-100');
                        toggleDropdown(!isOpen);
                    } else if (e.key === 'Escape') {
                        toggleDropdown(false);
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (!modeSelectorDropdown?.classList.contains('opacity-100')) {
                            closeAllMenusExcept(modeSelectorClose);
                        }
                        toggleDropdown(true);
                        const firstOption = modeDropdownOptions[0];
                        if (firstOption) firstOption.focus();
                    }
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

                const close = () => {
                    dropdownEl.classList.remove(...openClasses);
                    dropdownEl.classList.add(...closedClasses);
                    buttonEl.setAttribute('aria-expanded', 'false');
                };

                const open = () => {
                    closeAllMenusExcept(close);
                    dropdownEl.classList.remove(...closedClasses);
                    dropdownEl.classList.add(...openClasses);
                    buttonEl.setAttribute('aria-expanded', 'true');
                };

                const toggle = () => {
                    if (isOpen()) {
                        close();
                    } else {
                        open();
                    }
                };

                menuCloseRegistry.push(close);

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
                            // Defer close for links so navigation isn't cancelled when dropdown hides
                            const isLink = item.tagName === 'A' && item.getAttribute('href');
                            if (isLink) {
                                setTimeout(close, 0);
                            } else {
                                close();
                            }
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
            
            // QR Modal and donation addresses
            const DONATION_ADDRESSES = {
                sol: 'F6mjNXKBKzjmKTK1Z9cWabFHZYtxMg8rojuNuppX2EG1',
                ada: '',
                bnb: '',
                doge: '',
                xmr: ''
            };
            const DONATION_LABELS = { sol: 'SOL wallet', ada: 'ADA wallet', bnb: 'BNB wallet', doge: 'DOGE wallet', xmr: 'XMR wallet' };
            const donationChain = document.getElementById('donation-chain');
            const donationAddress = document.getElementById('donation-address');
            const donationCopy = document.getElementById('donation-copy');
            const donationQr = document.getElementById('donation-qr');
            const donationNetworkLabel = document.getElementById('donation-network-label');
            const updateDonationUI = (chain) => {
                const addr = DONATION_ADDRESSES[chain] || '';
                if (donationAddress) {
                    donationAddress.textContent = addr || 'Address not configured';
                    donationAddress.dataset.address = addr;
                }
                if (donationNetworkLabel) donationNetworkLabel.textContent = DONATION_LABELS[chain] || 'Wallet';
                if (donationQr && typeof QRCode !== 'undefined') {
                    donationQr.innerHTML = '';
                    if (addr) new QRCode(donationQr, { text: addr, width: 160, height: 160 });
                }
            };
            if (donationChain) {
                donationChain.addEventListener('change', () => updateDonationUI(donationChain.value));
            }
            if (donationCopy && donationAddress) {
                donationCopy.addEventListener('click', () => {
                    const addr = donationAddress.dataset.address;
                    if (addr) Utils.copyToClipboard(addr);
                });
            }
            if (donationAddress) {
                donationAddress.addEventListener('click', () => {
                    const addr = donationAddress.dataset.address;
                    if (addr) Utils.copyToClipboard(addr);
                });
            }
            const toggleModal = Utils.bindModal(els.qrModal, [els.solBtn], [els.qrBackdrop, els.qrClose]);
            if (els.qrModal && els.solBtn) {
                els.solBtn.addEventListener('click', () => {
                    const chain = donationChain?.value || 'sol';
                    updateDonationUI(chain);
                });
            }

            // Video Modal with lazy loading (accessible from main screen header)
            const videoIframe = els.videoModal?.querySelector('iframe');
            const videoSrc = videoIframe?.dataset.src || videoIframe?.src || '';
            const toggleVideo = (show) => {
                els.videoModal?.classList.toggle('open', show);
                if (videoIframe) videoIframe.src = show ? videoSrc : '';
            };
            const openVideo = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                if (els.videoModal) toggleVideo(true);
            };
            if (els.videoBtn) els.videoBtn.addEventListener('click', openVideo);
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
                    if (window._orderSkewToggleHowItWorks) window._orderSkewToggleHowItWorks(false);
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

        });
    };
})();
