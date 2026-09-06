// Read and validate visible fields before producing a plan.
(function () {
    Calculator.validateSettings = (settings, rangeMode, bounds) => {
        const { C, currentPrice, N, S, depth, feeValue, existingAvgPrice } = settings;
        const sellOnly = settings.tradingMode === 'sell-only';
        const buyOnly = settings.tradingMode === 'buy-only';
        const invalidIds = [], invalidMessages = [];
        const require = (valid, id, message) => {
            if (!valid) { invalidIds.push(id); invalidMessages.push(message); }
        };
        require(Number.isFinite(C) && C > 0, sellOnly ? 'existing_quantity' : 'starting_capital',
            `${sellOnly ? 'Held Quantity' : 'Initial Capital'} must be a positive number.`);
        require(Number.isFinite(currentPrice) && currentPrice > 0, sellOnly ? 'current_price_sell' : 'current_price',
            'Initial Asset Price must be a positive number.');
        require(Number.isInteger(N) && N >= 2 && N <= 50, 'number_of_rungs_input', 'Enter 2 to 50 whole orders.');
        require(Number.isFinite(S) && S >= 0 && S <= 100, 'skew_value', 'Capital Skew must be from 0 to 100.');
        require(Number.isFinite(feeValue) && feeValue >= 0 && (settings.feeType !== 'percent' || feeValue < 100),
            'fee_value', 'Enter a nonnegative fee; percentage fees must be below 100%.');
        if (sellOnly) require(existingAvgPrice === null || (Number.isFinite(existingAvgPrice) && existingAvgPrice >= 0),
            'existing_avg_price', 'Average Cost Basis must be zero or positive, or left blank.');
        if (rangeMode === 'floor') {
            if (!sellOnly) require(Number.isFinite(bounds.buyPriceEnd) && bounds.buyPriceEnd > 0 && bounds.buyPriceEnd < currentPrice,
                'buy_floor', 'Buy Range Low must be positive and below Initial Asset Price.');
            if (!buyOnly) require(Number.isFinite(bounds.sellPriceEnd) && bounds.sellPriceEnd > currentPrice,
                'sell_ceiling', 'Sell Range High must be above Initial Asset Price.');
        } else require(Number.isFinite(depth) && depth >= 0.1 && depth <= 99,
            'depth_input', 'Range must be from 0.1% to 99%.');
        return { isReady: !invalidIds.length, missingIds: [], missingLabels: [], invalidIds, invalidMessages };
    };
    window.OrderSkewModules = window.OrderSkewModules || {};
    window.OrderSkewModules.attachCalculatorMethods = (App, els) => {
        const number = (el) => {
            const value = Utils.stripCommas(el?.value).trim();
            return value === '' ? NaN : Number(value);
        };
        Object.assign(App, {
            debouncedCalc: () => App.calculatePlanDebounced?.(),
            resolvePlanSettings: () => {
                const sellOnly = State.tradingMode === 'sell-only';
                return {
                    tradingMode: State.tradingMode,
                    C: number(sellOnly ? els.existQty : els.startCap),
                    currentPrice: number(sellOnly ? els.currPriceSell : els.currPrice),
                    existingAvgPrice: els.existAvg?.value.trim() ? number(els.existAvg) : null,
                    N: number(els.rungsInput || els.rungs), S: number(els.skew),
                    depth: number(els.depthInput || els.depth),
                    feeType: els.feeType?.value, feeValue: number(els.feeValue),
                    feeSettlement: els.feeSettlement?.value, spacingMode: els.spacingMode?.value
                };
            },
            resolvePriceBounds: (currentPrice, depth) => els.priceRangeMode?.value === 'floor'
                ? { buyPriceEnd: number(els.buyFloor), sellPriceEnd: number(els.sellCeiling) }
                : { buyPriceEnd: currentPrice * (1 - depth / 100), sellPriceEnd: currentPrice * (1 + depth / 100) },
            getRequiredInputState: settings => Calculator.validateSettings(settings, els.priceRangeMode?.value,
                App.resolvePriceBounds(settings.currentPrice, settings.depth)),
            getStrategySignature: () => JSON.stringify({ ...App.resolvePlanSettings(),
                rangeMode: els.priceRangeMode?.value, buyFloor: els.buyFloor?.value, sellCeiling: els.sellCeiling?.value }),
            calculatePlan: () => {
                const signature = App.getStrategySignature();
                if (State.lastStrategySignature !== null && State.lastStrategySignature !== signature) App.resetCopyCellHighlights();
                State.lastStrategySignature = signature;
                const settings = App.resolvePlanSettings();
                const validation = App.getRequiredInputState(settings);
                if (!validation.isReady) {
                    State.currentPlanData = null;
                    App.setPendingOutputs(validation);
                    return;
                }
                const bounds = App.resolvePriceBounds(settings.currentPrice, settings.depth);
                if (settings.tradingMode === 'sell-only') bounds.buyPriceEnd = settings.currentPrice;
                if (settings.tradingMode === 'buy-only') bounds.sellPriceEnd = settings.currentPrice;
                const plan = Calculator.createPlan({ ...settings, ...bounds });
                const planError = Calculator.getPlanError(plan);
                if (planError) {
                    State.currentPlanData = null;
                    App.setPendingOutputs({ isReady: false, invalidIds: ['fee_value'], invalidMessages: [planError] });
                    return;
                }
                State.currentPlanData = plan;
                App.updateUI(plan);
            }
        });
    };
})();
