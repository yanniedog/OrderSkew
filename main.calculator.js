// OrderSkew module: attachCalculatorMethods
(function () {
    window.OrderSkewModules = window.OrderSkewModules || {};

    window.OrderSkewModules.attachCalculatorMethods = (App, els) => {
        Object.assign(App, {
        debouncedCalc: () => {
            if (typeof App.calculatePlanDebounced === 'function') {
                App.calculatePlanDebounced();
            }
        },


        resolvePlanSettings: () => {
            const mode = State.tradingMode;
            const isSellOnly = mode === 'sell-only';
            const capitalSource = isSellOnly ? els.existQty?.value : els.startCap?.value;
            const priceSource = isSellOnly ? els.currPriceSell?.value : els.currPrice?.value;
            const C = parseFloat(Utils.stripCommas(capitalSource)) || 0;
            const currentPrice = parseFloat(Utils.stripCommas(priceSource)) || 0;
            const isShortSell = false;
            const simpleSettings = {
                N: 10,
                S: 50,
                depth: 25,
                feeType: 'percent',
                feeValue: 0.075,
                feeSettlement: 'netted',
                spacingMode: 'absolute',
                sellOnly: false,
                buyOnly: false
            };
            const advancedSettings = {
                N: parseInt(els.rungs?.value, 10) || 2,
                S: parseInt(els.skew?.value, 10) || 0,
                depth: parseFloat(els.depth?.value) || 20,
                feeType: els.feeType?.value || 'percent',
                feeValue: parseFloat(els.feeValue?.value) || 0,
                feeSettlement: els.feeSettlement?.value || 'netted',
                spacingMode: els.spacingMode?.value || 'absolute',
                sellOnly: els.sellOnlyCheck?.checked || false,
                buyOnly: State.buyOnlyMode || false
            };
            const settings = State.mode === 'simple' ? simpleSettings : advancedSettings;
            if (isShortSell) {
                settings.sellOnly = false;
                settings.buyOnly = false;
            }
            return { C, currentPrice, isShortSell, ...settings };
        },


        resolvePriceBounds: (currentPrice, depth) => {
            const useFloor = els.priceRangeMode?.value === 'floor';
            if (useFloor) {
                const buyFloorValue = parseFloat(els.buyFloor?.value);
                const sellCeilingValue = parseFloat(els.sellCeiling?.value);
                return {
                    buyPriceEnd: !Number.isNaN(buyFloorValue) ? buyFloorValue : currentPrice * 0.8,
                    sellPriceEnd: !Number.isNaN(sellCeilingValue) ? sellCeilingValue : currentPrice * 1.2
                };
            }
            return {
                buyPriceEnd: currentPrice * (1 - depth / 100),
                sellPriceEnd: currentPrice * (1 + depth / 100)
            };
        },

        getRequiredInputState: ({ C, currentPrice }) => {
            const mode = State.tradingMode;
            const isBuyOnly = mode === 'buy-only';
            const isSellOnly = mode === 'sell-only';
            const useFloor = els.priceRangeMode?.value === 'floor';
            const buyFloor = parseFloat(els.buyFloor?.value);
            const sellCeiling = parseFloat(els.sellCeiling?.value);
            const missing = [];
            const invalid = [];
            const invalidIds = [];

            if (!(Number.isFinite(C) && C > 0)) {
                const capLabel = isSellOnly ? 'Held Quantity' : 'Initial Capital';
                missing.push({ id: isSellOnly ? 'existing_quantity' : 'starting_capital', label: capLabel });
            }
            if (!(Number.isFinite(currentPrice) && currentPrice > 0)) {
                missing.push({ id: isSellOnly ? 'current_price_sell' : 'current_price', label: 'Initial Asset Price' });
            }
            if (useFloor && Number.isFinite(currentPrice) && currentPrice > 0) {
                if (!isSellOnly && Number.isFinite(buyFloor) && buyFloor > 0 && buyFloor >= currentPrice) {
                    invalid.push('Buy Range Low must be below Initial Asset Price.');
                    invalidIds.push('buy_floor');
                }
                if (!isBuyOnly && Number.isFinite(sellCeiling) && sellCeiling > 0 && sellCeiling <= currentPrice) {
                    invalid.push('Sell Range High must be above Initial Asset Price.');
                    invalidIds.push('sell_ceiling');
                }
            }

            return {
                isReady: missing.length === 0 && invalid.length === 0,
                missingIds: missing.map((f) => f.id),
                missingLabels: missing.map((f) => f.label),
                invalidIds,
                invalidMessages: invalid
            };
        },

        getStrategySignature: () => {
            return JSON.stringify({
                mode: State.tradingMode,
                appMode: State.mode,
                startCapital: Utils.stripCommas(els.startCap?.value ?? ''),
                currentPrice: Utils.stripCommas(els.currPrice?.value ?? ''),
                currentPriceSell: Utils.stripCommas(els.currPriceSell?.value ?? ''),
                existingQuantity: Utils.stripCommas(els.existQty?.value ?? ''),
                existingAvgPrice: Utils.stripCommas(els.existAvg?.value ?? ''),
                rungs: els.rungs?.value ?? '',
                skew: els.skew?.value ?? '',
                depth: els.depth?.value ?? '',
                priceRangeMode: els.priceRangeMode?.value ?? '',
                buyFloor: Utils.stripCommas(els.buyFloor?.value ?? ''),
                sellCeiling: Utils.stripCommas(els.sellCeiling?.value ?? ''),
                feeType: els.feeType?.value ?? '',
                feeValue: Utils.stripCommas(els.feeValue?.value ?? ''),
                feeSettlement: els.feeSettlement?.value ?? '',
                spacingMode: els.spacingMode?.value ?? '',
                sellOnlyChecked: !!els.sellOnlyCheck?.checked,
                sellOnlyHighestExecuted: State.sellOnlyHighestExecuted
            });
        },

        // --- CORE CALCULATION ---

        calculatePlan: () => {
            const strategySignature = App.getStrategySignature();
            if (State.lastStrategySignature !== null && State.lastStrategySignature !== strategySignature) {
                App.resetCopyCellHighlights();
            }
            State.lastStrategySignature = strategySignature;

            const {
                C,
                currentPrice,
                isShortSell,
                N,
                S,
                depth,
                feeType,
                feeValue,
                feeSettlement,
                spacingMode,
                sellOnly,
                buyOnly
            } = App.resolvePlanSettings();
            const inputState = App.getRequiredInputState({ C, currentPrice });
            if (!inputState.isReady) {
                State.currentPlanData = null;
                App.setPendingOutputs(inputState);
                return;
            }

            const feeRate = feeType === 'percent' ? feeValue / 100 : 0;
            const isFeeNetted = feeSettlement !== 'external';
            const hasValidCurrentPrice = Number.isFinite(currentPrice) && currentPrice > 0;
            const isRelativeSpacing = spacingMode === 'relative' && hasValidCurrentPrice;

            const { buyPriceEnd, sellPriceEnd } = App.resolvePriceBounds(currentPrice, depth);

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
                let cumNetRev = 0, cumQty = 0;
                sellLadder = sellLadder.map(r => {
                    const costBasis = avgBuyPrice * r.assetSize;
                    const profit = r.netRevenue - costBasis;
                    cumSold += r.assetSize;
                    cumProfit += profit;
                    cumNetRev += r.netRevenue;
                    cumQty += r.assetSize;
                    const avg = cumQty > 0 ? cumNetRev / cumQty : 0;
                    return { ...r, profit, cumSold, cumProfit, avg };
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
                let cumNetRev = 0, cumQty = 0;
                sellLadder.forEach(r => {
                    cumNetRev += r.netRevenue;
                    cumQty += r.assetSize;
                    r.avg = cumQty > 0 ? cumNetRev / cumQty : 0;
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

        });
    };
})();
