// OrderSkew module: attachUIMethods
(function () {
    window.OrderSkewModules = window.OrderSkewModules || {};

    window.OrderSkewModules.attachUIMethods = (App, els) => {
        Object.assign(App, {
        setElementVisible: (el, visible) => {
            if (!el) return;
            el.classList.toggle('hidden', !visible);
            el.style.display = visible ? '' : 'none';
        },


        setDetailExpanded: (detailEl, expanded) => {
            if (!detailEl) return;
            if (expanded) detailEl.setAttribute('open', '');
            else detailEl.removeAttribute('open');
        },


        redrawChart: (plan = State.currentPlanData) => {
            if (!plan || typeof drawDepthChart !== 'function') return;
            const summary = plan.summary;
            drawDepthChart('#depth-chart', plan.buyLadder, plan.sellLadder, summary?.avgBuy, summary?.avgSell);
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


        loadCopyDecimalPlaces: () => {
            const saved = localStorage.getItem(CONSTANTS.STORAGE_PREFIX + 'copy_decimal_places');
            const parsed = saved !== null ? parseInt(saved, 10) : 8;
            State.copyDecimalPlaces = Number.isFinite(parsed) ? Math.min(CONSTANTS.MAX_COPY_DECIMALS, Math.max(0, parsed)) : CONSTANTS.MAX_COPY_DECIMALS;
            if (els.copyDecimalPlaces) els.copyDecimalPlaces.value = State.copyDecimalPlaces;
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
            const priceRangeDetails = document.getElementById('price-range-details');
            const allocationDetails = document.getElementById('allocation-details');
            const advancedPanels = [modeToggleContainer, chartDisplayOptions, tableOptions, exportMenu];
            
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

            // Progressive disclosure: Advanced mode expands Price Range & Allocation, beginner mode keeps them collapsed
            if (State.advancedMode) {
                App.setDetailExpanded(priceRangeDetails, true);
                App.setDetailExpanded(allocationDetails, true);
                advancedPanels.forEach(panel => App.setElementVisible(panel, true));
                // Set mode to pro to show all customization options
                if (State.mode !== 'pro') {
                    App.setMode('pro');
                }
            } else {
                App.setDetailExpanded(priceRangeDetails, false);
                App.setDetailExpanded(allocationDetails, false);
                advancedPanels.forEach(panel => App.setElementVisible(panel, false));
                // Keep mode as is - don't force simple mode, but hide advanced controls
            }
        },


        setMode: (mode) => {
            State.mode = mode;
            const activeClass = "shadow-sm bg-[var(--color-card)] text-[var(--color-primary)]";
            const inactiveClass = "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]";
            
            if (els.modeSimple) els.modeSimple.className = `mode-switch-pill px-3 py-1 text-xs font-medium rounded-md transition-all ${mode==='simple'?activeClass:inactiveClass}`;
            if (els.modePro) els.modePro.className = `mode-switch-pill px-3 py-1 text-xs font-medium rounded-md transition-all ${mode==='pro'?activeClass:inactiveClass}`;
            
            
            const mainGrid = document.getElementById('main-content-grid');
            const configColumn = document.getElementById('config-column');
            const graphColumn = document.getElementById('graph-column');
            
            // Layout: Always use two columns on desktop (lg) to fill space; single column on mobile
            if (mainGrid) mainGrid.className = 'app-layout-grid grid grid-cols-1 lg:grid-cols-12 gap-6';
            if (configColumn) configColumn.className = 'controls-column lg:col-span-5 space-y-6 min-w-0';
            if (graphColumn) graphColumn.className = 'viz-column lg:col-span-7 space-y-6 min-w-0 overflow-hidden';
            
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
            const activeClass = "table-tab-btn buy-only-content flex-1 py-3 sm:py-2.5 text-xs font-medium text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] transition-colors";
            const inactiveClass = "table-tab-btn sell-only-content flex-1 py-3 sm:py-2.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border-b-2 border-transparent transition-colors";
            const activeClassSell = "table-tab-btn sell-only-content flex-1 py-3 sm:py-2.5 text-xs font-medium text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] transition-colors";
            const inactiveClassBuy = "table-tab-btn buy-only-content flex-1 py-3 sm:py-2.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border-b-2 border-transparent transition-colors";
            
            if (els.tabBuy) els.tabBuy.className = tab === 'buy' ? activeClass : inactiveClassBuy;
            if (els.tabSell) els.tabSell.className = tab === 'sell' ? activeClassSell : inactiveClass;
            els.panelBuy?.classList.toggle('hidden', tab !== 'buy');
            els.panelSell?.classList.toggle('hidden', tab !== 'sell');
        },


        updateModeLabels: () => {
            const buyLabel = 'Buy Orders';
            const sellLabel = 'Sell Orders';

            const tabBuyLabel = document.getElementById('tab-buy-label');
            const tabSellLabel = document.getElementById('tab-sell-label');
            if (tabBuyLabel) tabBuyLabel.textContent = buyLabel;
            if (tabSellLabel) tabSellLabel.textContent = sellLabel;

            const legendBuy = document.getElementById('legend-buy-label');
            const legendSell = document.getElementById('legend-sell-label');
            if (legendBuy) legendBuy.textContent = 'Buy';
            if (legendSell) legendSell.textContent = 'Sell';

            const labelBuySide = document.getElementById('label-buy-side');
            const labelSellSide = document.getElementById('label-sell-side');
            if (labelBuySide) labelBuySide.textContent = 'Buy Side';
            if (labelSellSide) labelSellSide.textContent = 'Sell Side';

            const labelAvgBuy = document.getElementById('label-avg-buy');
            const labelAvgSell = document.getElementById('label-avg-sell');
            const stickyLabelAvgBuy = document.getElementById('sticky-label-avg-buy');
            const stickyLabelAvgSell = document.getElementById('sticky-label-avg-sell');
            if (labelAvgBuy) labelAvgBuy.textContent = 'Avg Buy';
            if (labelAvgSell) labelAvgSell.textContent = 'Avg Sell';
            if (stickyLabelAvgBuy) stickyLabelAvgBuy.textContent = 'Avg Buy:';
            if (stickyLabelAvgSell) stickyLabelAvgSell.textContent = 'Avg Sell:';

            const buyTableLastCol = document.getElementById('buy-table-last-col');
            const sellTableLastCol = document.getElementById('sell-table-last-col');
            if (buyTableLastCol) buyTableLastCol.textContent = 'Avg Price';
            if (sellTableLastCol) sellTableLastCol.textContent = 'Profit';

            const buyRangeLabel = document.getElementById('buy-range-label');
            const sellRangeLabel = document.getElementById('sell-range-label');
            if (buyRangeLabel) buyRangeLabel.textContent = 'Buy Range Low';
            if (sellRangeLabel) sellRangeLabel.textContent = 'Sell Range High';
        },

        updateCopyCellHighlight: () => {
            document.querySelectorAll('[data-copy-cell-id]').forEach((cell) => {
                const cellId = cell.getAttribute('data-copy-cell-id');
                cell.classList.toggle('copy-cell-selected', cellId === State.selectedCopyCellId);
                cell.classList.toggle('copy-cell-copied', State.copiedCellIds?.has(cellId));
            });
        },

        resetCopyCellHighlights: () => {
            State.selectedCopyCellId = null;
            if (State.copiedCellIds && typeof State.copiedCellIds.clear === 'function') {
                State.copiedCellIds.clear();
            } else {
                State.copiedCellIds = new Set();
            }
            App.updateCopyCellHighlight();
        },

        setFieldValidationState: (missingFieldIds = []) => {
            const ids = new Set(missingFieldIds);
            const fields = [
                els.startCap,
                els.currPrice,
                els.currPriceSell,
                els.buyFloor,
                els.sellCeiling,
                els.existQty
            ];
            fields.forEach((field) => {
                if (!field || !field.id) return;
                field.classList.toggle('input-required-missing', ids.has(field.id));
            });
        },

        setPendingOutputs: (validation) => {
            const missingIds = Array.isArray(validation?.missingIds) ? validation.missingIds : [];
            const invalidIds = Array.isArray(validation?.invalidIds) ? validation.invalidIds : [];
            const invalidMessages = Array.isArray(validation?.invalidMessages) ? validation.invalidMessages : [];
            const hasMultiple = [...new Set([...missingIds, ...invalidIds])].length > 1;
            const simpleMessage = hasMultiple
                ? 'Fix the fields highlighted in red.'
                : 'Fix the field highlighted in red.';
            const detailMessage = invalidMessages.length ? ` ${invalidMessages.join(' ')}` : '';

            App.setFieldValidationState([...new Set([...missingIds, ...invalidIds])]);
            const chartSummaryOverlay = document.getElementById('chart-summary-overlay');
            if (chartSummaryOverlay) chartSummaryOverlay.classList.add('hidden');
            const sticky = els.stickyFooter;
            if (sticky) sticky.classList.remove('visible');

            const summaryIds = [
                'chart-summary-net-profit',
                'chart-summary-roi',
                'chart-summary-avg-buy',
                'chart-summary-avg-sell',
                'chart-summary-total-fees',
                'chart-summary-total-quantity',
                'chart-summary-buy-value',
                'chart-summary-buy-volume',
                'chart-summary-sell-value',
                'chart-summary-sell-volume',
                'sticky-net-profit',
                'sticky-roi',
                'sticky-avg-buy',
                'sticky-avg-sell',
                'sticky-fees',
                'sticky-vol',
                'sticky-floor',
                'sticky-ceiling'
            ];
            summaryIds.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.textContent = '-';
            });

            const midPriceLabel = document.getElementById('mid-price-label');
            if (midPriceLabel) midPriceLabel.textContent = 'Complete required inputs to generate projections.';

            const chart = document.getElementById('depth-chart');
            if (chart) chart.innerHTML = '';

            const chartEmptyState = document.getElementById('chart-empty-state');
            if (chartEmptyState) {
                chartEmptyState.classList.remove('hidden');
                chartEmptyState.innerHTML = `<div class="outputs-empty-panel"><p class="outputs-empty-title">${simpleMessage}</p><p class="outputs-empty-subtitle">Chart and ladder values will appear once corrected.${detailMessage}</p></div>`;
            }

            const buyTbody = document.getElementById('buy-ladder-body');
            const sellTbody = document.getElementById('sell-ladder-body');
            const colSpan = State.showFees ? 6 : 5;
            const row = `
                <tr>
                    <td colspan="${colSpan}" class="px-4 py-5">
                        <div class="outputs-table-empty">
                            <p class="outputs-table-empty-title">${simpleMessage}</p>
                            <p class="outputs-table-empty-note">Table rows will appear once corrected.${detailMessage}</p>
                        </div>
                    </td>
                </tr>
            `;
            if (buyTbody) buyTbody.innerHTML = row;
            if (sellTbody) sellTbody.innerHTML = row;
        },


        updateUI: (plan) => {
            if (!plan) return;
            App.setFieldValidationState([]);
            const chartSummaryOverlay = document.getElementById('chart-summary-overlay');
            if (chartSummaryOverlay) chartSummaryOverlay.classList.remove('hidden');
            const chartEmptyState = document.getElementById('chart-empty-state');
            if (chartEmptyState) chartEmptyState.classList.add('hidden');
            const s = plan.summary;
            const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            const setCls = (id, cls) => { const el = document.getElementById(id); if(el) el.className = cls; };
            
            const summaryMap = {
                'chart-summary-net-profit': Utils.fmtCurrDisplay(s.netProfit), 
                'chart-summary-roi': Utils.fmtPct(s.roi),
                'chart-summary-avg-buy': Utils.fmtCurrDisplay(s.avgBuy), 
                'chart-summary-avg-sell': Utils.fmtCurrDisplay(s.avgSell),
                'chart-summary-total-fees': Utils.fmtCurrDisplay(s.totalFees), 
                'chart-summary-total-quantity': Utils.fmtNumDisplay(s.totalQuantity),
                'chart-summary-buy-value': Utils.fmtCurrDisplay(s.buyTotalValue),
                'chart-summary-buy-volume': Utils.fmtNumDisplay(s.buyTotalVolume),
                'chart-summary-sell-value': Utils.fmtCurrDisplay(s.sellTotalValue),
                'chart-summary-sell-volume': Utils.fmtNumDisplay(s.sellTotalVolume),
                'sticky-net-profit': Utils.fmtCurrDisplay(s.netProfit), 
                'sticky-roi': Utils.fmtPct(s.roi),
                'sticky-avg-buy': Utils.fmtCurrDisplay(s.avgBuy), 
                'sticky-avg-sell': Utils.fmtCurrDisplay(s.avgSell),
                'sticky-fees': Utils.fmtCurrDisplay(s.totalFees), 
                'sticky-vol': Utils.fmtNumDisplay(s.totalQuantity),
                'sticky-floor': Utils.fmtCurrDisplay(s.rangeLow), 
                'sticky-ceiling': Utils.fmtCurrDisplay(s.rangeHigh)
            };
            Object.entries(summaryMap).forEach(([id, val]) => setTxt(id, val));
            setCls('chart-summary-net-profit', `text-lg font-bold ${s.netProfit >= 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-invalid)]'}`);
            setCls('chart-summary-roi', `text-lg font-bold ${s.roi >= 0 ? 'text-green-600' : 'text-red-500'}`);
            els.stickyFooter?.classList.add('visible');

            document.querySelectorAll('.fee-col').forEach(el => el.classList.toggle('hidden', !State.showFees));

            const renderRow = (r, isSell) => {
                const showExecuted = els.sellOnlyCheck?.checked;
                const side = isSell ? 'sell' : 'buy';
                const priceCellId = `${side}-${r.rung}-price`;
                const sizeCellId = `${side}-${r.rung}-size`;
                const selectedPriceClass = State.selectedCopyCellId === priceCellId ? 'copy-cell-selected' : '';
                const selectedSizeClass = State.selectedCopyCellId === sizeCellId ? 'copy-cell-selected' : '';
                const copiedPriceClass = State.copiedCellIds?.has(priceCellId) ? 'copy-cell-copied' : '';
                const copiedSizeClass = State.copiedCellIds?.has(sizeCellId) ? 'copy-cell-copied' : '';
                return `
                <td class="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">${isSell || !showExecuted ? '' : `<input type="checkbox" class="mr-2" ${State.sellOnlyHighestExecuted===r.rung?'checked':''} onclick="App.toggleExecuted(${r.rung})">`}${r.rung}</td>
                <td data-copy-cell-id="${priceCellId}" class="px-4 py-3 text-right font-mono copy-cursor hover:bg-[var(--color-border)] transition-colors ${copiedPriceClass} ${selectedPriceClass}" onclick="App.copy('${r.price}', '${priceCellId}')">${Utils.fmtNumDisplay(r.price)}</td>
                <td data-copy-cell-id="${sizeCellId}" class="px-4 py-3 text-right font-mono text-[var(--color-text)] copy-cursor hover:bg-[var(--color-border)] transition-colors ${copiedSizeClass} ${selectedSizeClass}" onclick="App.copy('${r.assetSize}', '${sizeCellId}')">${Utils.fmtNumDisplay(r.assetSize)}</td>
                <td class="px-4 py-3 text-right font-mono text-[var(--color-text-muted)]">${Utils.fmtNumDisplay(r.capital)}</td>
                ${State.showFees ? `<td class="px-4 py-3 text-right font-mono text-[var(--color-text-muted)]">${Utils.fmtNumDisplay(r.fee)}</td>` : ''}
                <td class="px-4 py-3 text-right font-mono font-medium ${isSell ? 'text-green-600' : 'text-[var(--color-text-secondary)]'}">
                    ${Utils.fmtNumDisplay(isSell ? r.profit : r.avg)}
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

            App.redrawChart(plan);
            
            setTimeout(() => App.ensureTableBottomSpace(), 100);
        },


        toggleExecuted: (rung) => {
            if(!els.sellOnlyCheck?.checked) return;
            window.App.toggleExecutedGlobal(rung);
        },


        copy: (val, cellId = null) => {
            State.selectedCopyCellId = cellId || null;
            if (cellId) State.copiedCellIds.add(cellId);
            const decimals = Number.isFinite(State.copyDecimalPlaces) ? State.copyDecimalPlaces : CONSTANTS.MAX_COPY_DECIMALS;
            const formatted = Utils.formatForCopy(val, decimals);
            Utils.copyToClipboard(formatted);
            App.updateCopyCellHighlight();
        },
        

        exportCSV: () => {
            if (!State.currentPlanData) return;
            const p = State.currentPlanData;
            const rows = [
                ['Type', 'Rung', 'Price', 'Size', 'Value', 'Profit/Avg'],
                ...p.buyLadder.map(r => ['Buy', r.rung, r.price, r.assetSize, r.capital, r.avg]),
                ...p.sellLadder.map(r => ['Sell', r.rung, r.price, r.assetSize, r.capital, r.profit])
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
        
        });
    };
})();
