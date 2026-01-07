// OrderSkew - Setup Wizard Module (wizard.js)

const SetupWizard = {
    currentStep: 0,
    answers: {},
    _handlers: {},
    
    getFieldMap: () => {
        const els = window.OrderSkewEls;
        return {
            'starting_capital': els?.startCap,
            'existing_quantity': els?.existQty,
            'current_price': els?.currPrice,
            'number_of_rungs': els?.rungsInput,
            'depth': els?.depthInput,
            'skew_value': els?.skew,
            'fee_value': els?.feeValue,
            'sell_only_mode': els?.sellOnlyCheck
        };
    },
    
    setFieldValue: (field, value, element) => {
        const els = window.OrderSkewEls;
        if (!element || value === undefined) return;
        if (field === 'starting_capital') {
            element.value = Utils.formatNumberWithCommas(value.toString());
        } else if (field === 'number_of_rungs') {
            const v = Math.round(value);
            element.value = v;
            if (els?.rungs) els.rungs.value = v;
            if (els?.rungsDisplay) els.rungsDisplay.textContent = v;
        } else if (field === 'depth') {
            element.value = value;
            if (els?.depth) els.depth.value = value;
        } else if (field === 'skew_value') {
            element.value = value;
            const v = parseInt(value);
            if (els?.skewLabel) els.skewLabel.textContent = v === 0 ? "Flat" : v <= 30 ? "Gentle" : v <= 70 ? "Moderate" : "Aggressive";
        } else if (field === 'sell_only_mode') {
            element.checked = value;
            els?.sellOnlyInputs?.classList.toggle('hidden', !value);
        } else {
            element.value = value;
        }
    },
    
    questions: [
        {
            question: "What's your goal?",
            hint: "This determines how the calculator works",
            tooltip: "Choose your trading strategy: Buy Only for accumulation, Sell Only for exit planning, or Buy + Sell for a complete round-trip strategy.",
            type: "mode_choice",
            field: "trading_mode",
            options: [
                { 
                    label: "Buy Only", 
                    value: "buy-only", 
                    description: "I want to accumulate",
                    icon: "↓",
                    color: "red"
                },
                { 
                    label: "Sell Only", 
                    value: "sell-only", 
                    description: "I already own the asset",
                    icon: "↑",
                    color: "green"
                },
                { 
                    label: "Buy + Sell", 
                    value: "buy-sell", 
                    description: "Plan both buy and sell ladders",
                    icon: "↕",
                    color: "cyan"
                }
            ],
            default: "buy-only"
        },
        {
            question: "How much are you working with?",
            hint: "Enter your capital (buy mode) or quantity held (sell mode)",
            tooltip: "For Buy Only or Buy + Sell: Enter total capital available. For Sell Only: Enter the quantity of assets you currently hold.",
            type: "currency",
            field: "starting_capital",
            placeholder: "10,000",
            default: undefined
        },
        {
            question: "What's the current price?",
            hint: "The asset's market price right now",
            tooltip: "Enter the current market price of the asset. This serves as the baseline for calculating your buy and sell order ladders.",
            type: "currency",
            field: "current_price",
            placeholder: "100",
            default: undefined
        },
        {
            question: "What's your target?",
            hint: "Your lowest buy price or highest sell price",
            tooltip: "For Buy Only: Enter the lowest price you want to buy at. For Sell Only: Enter the highest price you want to sell at. For Buy + Sell: Enter the range percentage (default 25% means buys 25% below and sells 25% above current price).",
            type: "currency",
            field: "target_price",
            placeholder: "80",
            min: 0.01,
            default: undefined,
            dynamicHint: true
        }
    ],

    init: () => {
        SetupWizard.currentStep = 0;
        SetupWizard.answers = {};
        SetupWizard.questions.forEach(q => {
            if (q.default !== undefined) {
                SetupWizard.answers[q.field] = q.default;
            }
        });
        SetupWizard.answers['number_of_rungs'] = 8;
        SetupWizard.show();
    },

    prepare: () => {
        SetupWizard.currentStep = 0;
        SetupWizard.answers = {};
        SetupWizard.questions.forEach(q => {
            if (q.default !== undefined) {
                SetupWizard.answers[q.field] = q.default;
            }
        });
        SetupWizard.answers['number_of_rungs'] = 8;
    },

    bindControls: () => {
        const wizard = document.getElementById('setup-wizard');
        if (!wizard) {
            console.error('SetupWizard: Wizard container not found during bindControls');
            return;
        }

        const nextBtn = document.getElementById('wizard-next');
        const backBtn = document.getElementById('wizard-back');
        const skipBtn = document.getElementById('wizard-skip');

        if (!SetupWizard._handlers.nextClick) {
            SetupWizard._handlers.nextClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                SetupWizard.next();
            };
        }

        if (!SetupWizard._handlers.backClick) {
            SetupWizard._handlers.backClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                SetupWizard.back();
            };
        }

        if (!SetupWizard._handlers.skipClick) {
            SetupWizard._handlers.skipClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                SetupWizard.skip();
            };
        }

        if (!SetupWizard._handlers.keydown) {
            SetupWizard._handlers.keydown = (event) => {
                if (event.key === 'Escape') {
                    SetupWizard.skip();
                }
            };
        }

        if (nextBtn) {
            nextBtn.removeEventListener('click', SetupWizard._handlers.nextClick);
            nextBtn.addEventListener('click', SetupWizard._handlers.nextClick);
        }
        if (backBtn) {
            backBtn.removeEventListener('click', SetupWizard._handlers.backClick);
            backBtn.addEventListener('click', SetupWizard._handlers.backClick);
        }
        if (skipBtn) {
            skipBtn.removeEventListener('click', SetupWizard._handlers.skipClick);
            skipBtn.addEventListener('click', SetupWizard._handlers.skipClick);
        }

        wizard.removeEventListener('keydown', SetupWizard._handlers.keydown);
        wizard.addEventListener('keydown', SetupWizard._handlers.keydown);
    },

    show: () => {
        const wizard = document.getElementById('setup-wizard');
        const totalSteps = document.getElementById('wizard-total-steps');
        const backBtn = document.getElementById('wizard-back');
        const nextBtn = document.getElementById('wizard-next');

        if (!wizard) {
            console.error('SetupWizard: Wizard container not found');
            return;
        }

        if (totalSteps) totalSteps.textContent = SetupWizard.questions.length;
        SetupWizard.renderQuestion();
        
        wizard.style.opacity = '';
        wizard.style.pointerEvents = '';
        
        wizard.classList.add('open');
        wizard.style.opacity = '1';
        wizard.style.pointerEvents = 'auto';

        SetupWizard.bindControls();

        if (nextBtn) {
            if (SetupWizard.currentStep === SetupWizard.questions.length - 1) {
                nextBtn.textContent = 'Finish Setup';
                nextBtn.setAttribute('aria-label', 'Finish setup wizard');
            } else {
                nextBtn.textContent = 'Next →';
                nextBtn.setAttribute('aria-label', 'Go to next question');
            }
        }
        if (backBtn) {
            backBtn.classList.toggle('hidden', SetupWizard.currentStep === 0);
        }
    },

    renderQuestion: () => {
        const wizardContent = document.getElementById('wizard-content');
        let question = SetupWizard.questions[SetupWizard.currentStep];
        const stepNum = document.getElementById('wizard-step-num');
        const progress = document.getElementById('wizard-progress');
        
        const tradingMode = SetupWizard.answers['trading_mode'] || 'buy-only';
        const isSellOnly = tradingMode === 'sell-only';
        const isBuyOnly = tradingMode === 'buy-only';
        const isBuySell = tradingMode === 'buy-sell';
        
        if (question.field === 'starting_capital') {
            if (isSellOnly) {
                question = {
                    ...question,
                    question: "How many shares would you like to sell?",
                    hint: "Quantity you hold",
                    type: "number",
                    field: "existing_quantity",
                    placeholder: "50"
                };
            } else if (isBuyOnly) {
                question = {
                    ...question,
                    question: "How much money would you like to invest?",
                    hint: "Total capital available for buying",
                    type: "currency",
                    field: "starting_capital",
                    placeholder: "10,000"
                };
            } else if (isBuySell) {
                question = {
                    ...question,
                    question: "How much money would you like to invest?",
                    hint: "Total capital available for buying",
                    type: "currency",
                    field: "starting_capital",
                    placeholder: "10,000"
                };
            }
        }
        
        if (question.field === 'target_price') {
            if (isSellOnly) {
                question = {
                    ...question,
                    question: "Highest sell price?",
                    hint: "Top of your sell ladder. Range calculated automatically.",
                    tooltip: "Enter the highest price at which you want to place a sell order. All sell orders will be distributed between current price and this target.",
                    field: "target_price",
                    placeholder: "120"
                };
            } else if (isBuySell) {
                question = {
                    ...question,
                    question: "How wide should your price range be?",
                    hint: "Enter a percentage. For example, 25% means buy orders will be 25% below current price and sell orders 25% above.",
                    tooltip: "This sets how far your buy and sell orders spread from the current price. A higher percentage means orders are placed further away, capturing bigger price swings.",
                    type: "percentage",
                    field: "range_percent",
                    placeholder: "25",
                    default: 25,
                    min: 0.1,
                    max: 99
                };
            } else {
                question = {
                    ...question,
                    question: "Lowest buy price?",
                    hint: "Bottom of your buy ladder. Range calculated automatically.",
                    tooltip: "Enter the lowest price at which you want to place a buy order. All buy orders will be distributed between current price and this target.",
                    field: "target_price",
                    placeholder: "80"
                };
            }
        }
        
        if (question.field === 'starting_capital') {
            if (isSellOnly) {
                question = {
                    ...question,
                    tooltip: "Enter the total quantity of assets you currently hold and want to sell using the ladder strategy."
                };
            } else if (isBuySell) {
                question = {
                    ...question,
                    tooltip: "Enter the total capital you want to invest. This will be distributed across buy orders, and the resulting assets will be used for sell orders."
                };
            } else {
                question = {
                    ...question,
                    tooltip: "Enter the total capital available for buying. This amount will be distributed across multiple buy orders at different price levels."
                };
            }
        }
        
        if (question.field === 'current_price') {
            question = {
                ...question,
                tooltip: "The current market price serves as the baseline. Buy orders will be placed below this price, and sell orders above it (in Buy + Sell mode)."
            };
        }
        
        stepNum.textContent = SetupWizard.currentStep + 1;
        const progressPercent = ((SetupWizard.currentStep + 1) / SetupWizard.questions.length) * 100;
        progress.style.width = progressPercent + '%';
        progress.setAttribute('aria-valuenow', Math.round(progressPercent));
        
        const errorEl = document.getElementById('wizard-error');
        if (errorEl) {
            errorEl.classList.remove('show');
            errorEl.textContent = '';
        }
        
        let html = `
            <div class="wizard-question">
                <div class="flex items-start justify-between gap-3 mb-4 relative">
                    <h3 class="text-2xl md:text-3xl font-bold text-[var(--color-text)] flex-1">${question.question}</h3>
                    ${question.tooltip ? `
                        <div class="relative flex-shrink-0">
                            <button type="button" 
                                    class="wizard-tooltip-btn w-6 h-6 rounded-full bg-[var(--color-card-muted)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] transition-all flex items-center justify-center text-xs font-medium active:scale-95"
                                    onclick="const tooltip = this.parentElement.querySelector('.wizard-tooltip-content'); tooltip?.classList.toggle('hidden')"
                                    aria-label="Show explanation">
                                ?
                            </button>
                            <div class="wizard-tooltip-content hidden absolute right-0 top-full mt-2 w-64 p-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg text-xs text-[var(--color-text-secondary)] z-50">
                                ${question.tooltip}
                            </div>
                        </div>
                    ` : ''}
                </div>
                <p class="wizard-hint">${question.hint}</p>
        `;

        if (question.type === 'currency' || question.type === 'number' || question.type === 'percentage' || question.type === 'fee') {
            const valueField = question.field === 'starting_capital' && isSellOnly ? 'existing_quantity' : question.field;
            let actualValue = SetupWizard.answers[valueField];
            const currentPrice = SetupWizard.answers['current_price'] || 0;
            
            let defaultValue = question.default;
            if (question.field === 'target_price' && currentPrice > 0 && !isBuySell) {
                const calculatedDefault = isSellOnly ? currentPrice * 1.25 : currentPrice * 0.75;
                defaultValue = calculatedDefault;
                
                if (actualValue === undefined || actualValue === null) {
                    actualValue = calculatedDefault;
                    SetupWizard.answers[valueField] = calculatedDefault;
                } else {
                    const tolerance = 0.01;
                    if (Math.abs(actualValue - calculatedDefault) <= tolerance) {
                        actualValue = calculatedDefault;
                        SetupWizard.answers[valueField] = calculatedDefault;
                    }
                }
            } else if (question.field === 'range_percent' && isBuySell) {
                defaultValue = 25;
                if (actualValue === undefined || actualValue === null) {
                    actualValue = 25;
                    SetupWizard.answers['range_percent'] = 25;
                }
            }
            
            let currentValue = '';
            if (actualValue !== undefined && actualValue !== null) {
                if (question.type === 'currency' && actualValue >= 1000) {
                    currentValue = Utils.formatNumberWithCommas(actualValue.toString());
                } else {
                    currentValue = actualValue.toString();
                }
            } else if (defaultValue !== undefined && defaultValue !== null) {
                if (question.type === 'currency' && defaultValue >= 1000) {
                    currentValue = Utils.formatNumberWithCommas(defaultValue.toString());
                } else {
                    currentValue = defaultValue.toString();
                }
            }
            const inputType = question.type === 'number' ? 'number' : 'text';
            const isCurrency = question.type === 'currency';
            const isPercentage = question.type === 'percentage' || question.field === 'range_percent';
            const showRangeCalc = question.field === 'target_price' && !isBuySell;
            const showBuySellTargets = question.field === 'range_percent' && isBuySell;
            
            html += `
                <div class="mt-6">
                    <label for="wizard-input" class="sr-only">${question.question}</label>
                    <div class="relative flex items-center gap-4">
                        <div class="flex-1 relative">
                            ${isCurrency ? '<span class="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-secondary)] font-mono">$</span>' : ''}
                            <input 
                                type="${inputType}"
                                id="wizard-input" 
                                class="wizard-input ${isCurrency ? 'pl-7' : ''}" 
                                placeholder="${question.placeholder || ''}"
                                value="${currentValue}"
                                ${question.min !== undefined ? `min="${question.min}"` : ''}
                                ${question.max !== undefined ? `max="${question.max}"` : ''}
                                aria-describedby="wizard-hint"
                                autocomplete="off"
                            >
                            ${isPercentage ? '<span class="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--color-text-secondary)] font-mono">%</span>' : ''}
                        </div>
                        ${showRangeCalc ? `<div id="wizard-range-display" class="text-sm text-[var(--color-text-muted)] whitespace-nowrap">Range: <span class="font-mono">0%</span></div>` : ''}
                    </div>
                    ${showBuySellTargets ? `
                        <div id="wizard-buysell-targets" class="mt-4 p-3 bg-[var(--color-card-muted)] rounded-lg border border-[var(--color-border)]">
                            <div class="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <div class="text-[10px] text-[var(--color-text-muted)] uppercase mb-1">Lowest Buy Price</div>
                                    <div id="wizard-buy-target" class="font-mono font-semibold text-red-400">-</div>
                                </div>
                                <div>
                                    <div class="text-[10px] text-[var(--color-text-muted)] uppercase mb-1">Highest Sell Price</div>
                                    <div id="wizard-sell-target" class="font-mono font-semibold text-green-400">-</div>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        } else if (question.type === 'mode_choice') {
            html += '<div class="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup">';
            question.options.forEach((option, idx) => {
                const isSelected = SetupWizard.answers[question.field] === option.value || 
                                 (SetupWizard.answers[question.field] === undefined && option.value === question.default);
                const valueStr = typeof option.value === 'boolean' ? option.value : option.value;
                const colorMap = { red: 'red', green: 'green', cyan: 'cyan' };
                const colorClass = colorMap[option.color] || 'cyan';
                html += `
                    <button 
                        type="button"
                        class="wizard-mode-option relative p-4 rounded-xl border-2 transition-all hover:scale-102 ${isSelected ? `border-${colorClass}-500 bg-${colorClass}-500/10 shadow-lg` : 'border-[var(--color-border)] bg-[var(--color-card-muted)] hover:border-' + colorClass + '-500/50'}"
                        data-field="${question.field}"
                        data-value="${valueStr}"
                        role="radio"
                        aria-checked="${isSelected}"
                    >
                        <div class="text-2xl mb-2">${option.icon || ''}</div>
                        <div class="font-bold text-${colorClass}-500 text-sm mb-1">${option.label}</div>
                        <div class="text-xs text-[var(--color-text-muted)]">${option.description || ''}</div>
                        ${isSelected ? `<div class="absolute top-2 right-2 w-5 h-5 rounded-full bg-${colorClass}-500 text-white flex items-center justify-center"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg></div>` : ''}
                    </button>
                `;
            });
            html += '</div>';
        } else if (question.type === 'skew' || question.type === 'choice') {
            html += '<div class="mt-6 space-y-3" role="radiogroup" aria-labelledby="wizard-question-title">';
            question.options.forEach((option, idx) => {
                const isSelected = SetupWizard.answers[question.field] === option.value || 
                                 (SetupWizard.answers[question.field] === undefined && option.value === question.default);
                const valueStr = typeof option.value === 'boolean' ? option.value : option.value;
                const optionId = `wizard-option-${SetupWizard.currentStep}-${idx}`;
                html += `
                    <button 
                        type="button"
                        id="${optionId}"
                        class="wizard-option w-full ${isSelected ? 'selected' : ''}"
                        data-field="${question.field}"
                        data-value="${valueStr}"
                        role="radio"
                        aria-checked="${isSelected}"
                        aria-label="${option.label}${option.description ? ': ' + option.description : ''}"
                    >
                        <div class="flex flex-col items-start">
                            <span class="font-semibold">${option.label}</span>
                            ${option.description ? `<span class="text-sm text-[var(--color-text-muted)] mt-1">${option.description}</span>` : ''}
                        </div>
                    </button>
                `;
            });
            html += '</div>';
        }

        html += '</div>';
        wizardContent.innerHTML = html;

        if (question.field === 'target_price' && !isBuySell) {
            const currentPrice = SetupWizard.answers['current_price'] || 0;
            let targetPrice = SetupWizard.answers['target_price'];
            if ((!targetPrice || targetPrice === null) && currentPrice > 0) {
                targetPrice = isSellOnly ? currentPrice * 1.25 : currentPrice * 0.75;
                SetupWizard.answers['target_price'] = targetPrice;
                const input = document.getElementById('wizard-input');
                if (input) {
                    if (targetPrice >= 1000) {
                        input.value = Utils.formatNumberWithCommas(targetPrice.toString());
                    } else {
                        input.value = targetPrice.toString();
                    }
                }
            }
            const rangeDisplay = document.getElementById('wizard-range-display');
            if (rangeDisplay && currentPrice > 0 && targetPrice && targetPrice > 0) {
                const range = isSellOnly 
                    ? ((targetPrice - currentPrice) / currentPrice) * 100
                    : ((currentPrice - targetPrice) / currentPrice) * 100;
                rangeDisplay.innerHTML = `Range: <span class="font-mono">${Math.abs(range).toFixed(1)}%</span>`;
            }
        }
        
        if (question.field === 'range_percent' && isBuySell) {
            const currentPrice = SetupWizard.answers['current_price'] || 0;
            let rangePercent = SetupWizard.answers['range_percent'] || 25;
            const input = document.getElementById('wizard-input');
            if (input && (!input.value || input.value === '')) {
                input.value = '25';
                SetupWizard.answers['range_percent'] = 25;
            }
            SetupWizard.updateBuySellTargets(currentPrice, rangePercent);
        }

        // Close tooltips when clicking outside (only add once)
        if (!SetupWizard._tooltipCloseHandler) {
            SetupWizard._tooltipCloseHandler = (e) => {
                if (!e.target.closest('.wizard-tooltip-btn') && !e.target.closest('.wizard-tooltip-content')) {
                    const wizardContent = document.getElementById('wizard-content');
                    if (wizardContent) {
                        wizardContent.querySelectorAll('.wizard-tooltip-content').forEach(tooltip => {
                            tooltip.classList.add('hidden');
                        });
                    }
                }
            };
            document.addEventListener('click', SetupWizard._tooltipCloseHandler, true);
        }
        
        const input = document.getElementById('wizard-input');
        if (input) {
            setTimeout(() => {
                input.focus();
                if (input.type === 'text') {
                    input.select();
                }
            }, 150);
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    SetupWizard.next();
                }
            });
            input.addEventListener('input', () => {
                const errorEl = document.getElementById('wizard-error');
                if (errorEl) errorEl.classList.remove('show');
                
                if (question.field === 'target_price' && !isBuySell) {
                    const currentPrice = SetupWizard.answers['current_price'] || 0;
                    const targetPrice = parseFloat(input.value.replace(/,/g, '')) || 0;
                    const rangeDisplay = document.getElementById('wizard-range-display');
                    if (rangeDisplay && currentPrice > 0 && targetPrice > 0) {
                        const range = isSellOnly 
                            ? ((targetPrice - currentPrice) / currentPrice) * 100
                            : ((currentPrice - targetPrice) / currentPrice) * 100;
                        rangeDisplay.innerHTML = `Range: <span class="font-mono">${Math.abs(range).toFixed(1)}%</span>`;
                    }
                } else if (question.field === 'range_percent' && isBuySell) {
                    const currentPrice = SetupWizard.answers['current_price'] || 0;
                    const rangePercent = parseFloat(input.value) || 0;
                    SetupWizard.updateBuySellTargets(currentPrice, rangePercent);
                }
            });
        }

        const optionButtons = wizardContent.querySelectorAll('.wizard-option, .wizard-mode-option');
        optionButtons.forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                const field = btn.dataset.field;
                let value = btn.dataset.value;
                if (value === 'true') value = true;
                else if (value === 'false') value = false;
                else if (!isNaN(value) && value !== 'buy-sell' && value !== 'buy-only' && value !== 'sell-only') value = parseFloat(value);
                SetupWizard.selectOption(field, value);
            });
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    btn.click();
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    const nextIdx = (e.key === 'ArrowDown' || e.key === 'ArrowRight')
                        ? Math.min(idx + 1, optionButtons.length - 1)
                        : Math.max(idx - 1, 0);
                    optionButtons[nextIdx].focus();
                }
            });
        });
    },

    selectOption: (field, value) => {
        SetupWizard.answers[field] = value;
        SetupWizard.updateFormInRealTime();
        SetupWizard.renderQuestion();
        setTimeout(() => {
            if (SetupWizard.currentStep < SetupWizard.questions.length - 1) {
                SetupWizard.next();
            }
        }, 300);
    },

    showError: (message) => {
        const errorEl = document.getElementById('wizard-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add('show');
            errorEl.focus();
        }
    },

    next: () => {
        let question = SetupWizard.questions[SetupWizard.currentStep];
        const input = document.getElementById('wizard-input');
        
        const tradingMode = SetupWizard.answers['trading_mode'] || 'buy-only';
        const isSellOnly = tradingMode === 'sell-only';
        const isBuySell = tradingMode === 'buy-sell';
        
        // Determine the actual field being used (may differ from original question field)
        let actualField = question.field;
        let actualQuestionType = question.type;
        
        if (question.field === 'starting_capital' && isSellOnly) {
            actualField = 'existing_quantity';
            actualQuestionType = 'number';
        } else if (question.field === 'target_price' && isBuySell) {
            actualField = 'range_percent';
            actualQuestionType = 'percentage';
        }
        
        if (input) {
            let value = input.value.trim();
            
            // Handle default value for target_price (but not for range_percent in buy-sell)
            if (!value && question.field === 'target_price' && !isBuySell) {
                const currentPrice = SetupWizard.answers['current_price'] || 0;
                if (currentPrice > 0) {
                    value = (isSellOnly ? currentPrice * 1.25 : currentPrice * 0.75).toString();
                }
            }
            
            if (!value) {
                SetupWizard.showError('Please enter a value.');
                input.focus();
                return;
            }
            
            if (actualQuestionType === 'currency' || actualQuestionType === 'number' || actualQuestionType === 'percentage' || actualQuestionType === 'fee') {
                value = parseFloat(value.replace(/,/g, ''));
                if (isNaN(value) || value <= 0) {
                    SetupWizard.showError('Enter a valid positive number.');
                    input.focus();
                    input.select();
                    return;
                }
                if (question.min !== undefined && value < question.min) {
                    SetupWizard.showError(`Minimum: ${question.min}`);
                    input.focus();
                    input.select();
                    return;
                }
                if (question.max !== undefined && value > question.max) {
                    SetupWizard.showError(`Maximum: ${question.max}`);
                    input.focus();
                    input.select();
                    return;
                }
                if (actualField === 'target_price' && !isBuySell) {
                    const currentPrice = SetupWizard.answers['current_price'] || 0;
                    if (currentPrice > 0) {
                        if (isSellOnly && value <= currentPrice) {
                            SetupWizard.showError('Sell target must be above current price.');
                            input.focus();
                            input.select();
                            return;
                        } else if (!isSellOnly && value >= currentPrice) {
                            SetupWizard.showError('Buy target must be below current price.');
                            input.focus();
                            input.select();
                            return;
                        }
                    }
                }
            }
            
            // Save the value based on actual field
            if (actualField === 'target_price') {
                const currentPrice = SetupWizard.answers['current_price'] || 0;
                if (currentPrice > 0 && value > 0) {
                    const depth = isSellOnly
                        ? ((value - currentPrice) / currentPrice) * 100
                        : ((currentPrice - value) / currentPrice) * 100;
                    SetupWizard.answers['depth'] = Math.abs(depth);
                }
                SetupWizard.answers['target_price'] = value;
            } else if (actualField === 'range_percent') {
                SetupWizard.answers['range_percent'] = value;
                const currentPrice = SetupWizard.answers['current_price'] || 0;
                if (currentPrice > 0) {
                    SetupWizard.answers['depth'] = value;
                }
            } else {
                SetupWizard.answers[actualField] = value;
                
                if (question.field === 'current_price' && value > 0) {
                    if (isBuySell) {
                        // For buy-sell, update range targets if range_percent is set
                        const rangePercent = SetupWizard.answers['range_percent'] || 25;
                        SetupWizard.updateBuySellTargets(value, rangePercent);
                    } else {
                        const calculatedTargetPrice = isSellOnly ? value * 1.25 : value * 0.75;
                        if (SetupWizard.answers['target_price'] === undefined || 
                            SetupWizard.answers['target_price'] === null) {
                            SetupWizard.answers['target_price'] = calculatedTargetPrice;
                        }
                    }
                }
            }
            SetupWizard.updateFormInRealTime();
        } else if (question.type === 'skew' || question.type === 'choice' || question.type === 'mode_choice') {
            if (SetupWizard.answers[actualField] === undefined) {
                SetupWizard.answers[actualField] = question.default;
            }
            SetupWizard.updateFormInRealTime();
        }

        if (SetupWizard.currentStep < SetupWizard.questions.length - 1) {
            SetupWizard.currentStep++;
            SetupWizard.show();
        } else {
            SetupWizard.finish();
        }
    },

    back: () => {
        if (SetupWizard.currentStep > 0) {
            SetupWizard.currentStep--;
            SetupWizard.show();
        }
    },

    skip: () => {
        SetupWizard.finish(true);
    },

    finish: (wasSkipped = false) => {
        SetupWizard.applyAnswers();
        
        if (window.App) {
            window.App.setMode(wasSkipped ? 'pro' : 'simple');
        }
        
        const wizard = document.getElementById('setup-wizard');
        if (wizard) {
            wizard.classList.remove('open');
            wizard.style.opacity = '0';
            wizard.style.pointerEvents = 'none';
        }
        
        localStorage.setItem(CONSTANTS.STORAGE_PREFIX + 'setup_completed', 'true');
        
        // Update history state when wizard finishes
        history.pushState({ introVisible: false }, '');
        
        setTimeout(() => {
            if (window.App) {
                window.App.calculatePlan();
            }
        }, 300);
    },

    applyAnswers: () => {
        if (SetupWizard.answers['number_of_rungs'] === undefined) SetupWizard.answers['number_of_rungs'] = 8;
        const fieldMap = SetupWizard.getFieldMap();
        Object.keys(SetupWizard.answers).forEach(field => {
            SetupWizard.setFieldValue(field, SetupWizard.answers[field], fieldMap[field]);
        });
        
        // Apply trading mode
        const tradingMode = SetupWizard.answers['trading_mode'] || 'buy-only';
        if (window.App && window.App.setTradingMode) {
            window.App.setTradingMode(tradingMode);
        }
        
        // Apply range_percent to depth for buy-sell mode
        if (tradingMode === 'buy-sell' && SetupWizard.answers['range_percent']) {
            const depthInput = document.getElementById('depth_input');
            const depthSlider = document.getElementById('depth');
            if (depthInput) depthInput.value = SetupWizard.answers['range_percent'];
            if (depthSlider) depthSlider.value = SetupWizard.answers['range_percent'];
        }
    },

    updateBuySellTargets: (currentPrice, rangePercent) => {
        if (!currentPrice || !rangePercent) return;
        const buyTarget = currentPrice * (1 - rangePercent / 100);
        const sellTarget = currentPrice * (1 + rangePercent / 100);
        const overallRange = rangePercent * 2;
        
        const buyTargetEl = document.getElementById('wizard-buy-target');
        const sellTargetEl = document.getElementById('wizard-sell-target');
        const overallRangeEl = document.getElementById('wizard-overall-range');
        
        if (buyTargetEl) buyTargetEl.textContent = Utils.fmtCurr(buyTarget);
        if (sellTargetEl) sellTargetEl.textContent = Utils.fmtCurr(sellTarget);
        if (overallRangeEl) overallRangeEl.textContent = overallRange.toFixed(1) + '%';
    },
    
    updateFormInRealTime: () => {
        const question = SetupWizard.questions[SetupWizard.currentStep];
        if (!question) return;
        const tradingMode = SetupWizard.answers['trading_mode'] || 'buy-only';
        const isSellOnly = tradingMode === 'sell-only';
        const isBuySell = tradingMode === 'buy-sell';
        
        if (question.field === 'target_price' || SetupWizard.answers['target_price'] !== undefined) {
            const currentPrice = SetupWizard.answers['current_price'] || 0;
            const targetPrice = SetupWizard.answers['target_price'];
            if (currentPrice > 0 && targetPrice > 0) {
                SetupWizard.answers['depth'] = Math.abs((isSellOnly ? targetPrice - currentPrice : currentPrice - targetPrice) / currentPrice * 100);
            }
        }
        
        if (question.field === 'range_percent' && isBuySell) {
            const currentPrice = SetupWizard.answers['current_price'] || 0;
            const rangePercent = SetupWizard.answers['range_percent'] || 25;
            SetupWizard.answers['depth'] = rangePercent;
            SetupWizard.updateBuySellTargets(currentPrice, rangePercent);
        }
        
        const actualField = (question.field === 'starting_capital' && isSellOnly) ? 'existing_quantity' : question.field;
        const fieldMap = SetupWizard.getFieldMap();
        const answer = SetupWizard.answers[actualField] ?? SetupWizard.answers[question.field];
        SetupWizard.setFieldValue(actualField, answer, fieldMap[actualField]);
    }
};

// Expose to global scope
window.SetupWizard = SetupWizard;




