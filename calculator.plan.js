// Pure ladder accounting. Disclosure controls never change calculation settings.
(function () {
    const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
    const prices = (start, end, count, spacing) => Array.from({ length: count }, (_, i) => {
        const fraction = (i + 0.5) / count;
        return spacing === 'relative' ? start * Math.pow(end / start, fraction) : start + (end - start) * fraction;
    });
    const feeFor = (value, settings) => settings.feeType === 'percent'
        ? value * settings.feeValue / 100 : (value > 0 ? settings.feeValue : 0);

    const buildBuys = (settings, weights, buyPrices) => {
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let cumQty = 0, cumValue = 0;
        return weights.map((weight, i) => {
            const allocation = settings.C * (weight / totalWeight);
            const netted = settings.feeSettlement === 'netted';
            const netCapital = !netted ? allocation : settings.feeType === 'percent'
                ? allocation / (1 + settings.feeValue / 100) : allocation - settings.feeValue;
            const fee = netted ? allocation - netCapital : feeFor(netCapital, settings);
            const assetSize = netCapital / buyPrices[i];
            cumQty += assetSize;
            cumValue += netCapital;
            return { rung: i + 1, price: buyPrices[i], capital: netCapital + fee,
                netCapital, fee, assetSize, cumQty, avg: cumValue / cumQty };
        });
    };

    const buildSells = (settings, quantities, sellPrices, costPerUnit) => {
        let cumSold = 0, cumProfit = 0, cumRevenue = 0;
        return quantities.map((assetSize, i) => {
            const capital = assetSize * sellPrices[i];
            const fee = feeFor(capital, settings);
            const netRevenue = capital - (settings.feeSettlement === 'netted' ? fee : 0);
            const profit = costPerUnit === null ? null : capital - fee - costPerUnit * assetSize;
            cumSold += assetSize;
            cumProfit += profit || 0;
            cumRevenue += netRevenue;
            return { rung: i + 1, price: sellPrices[i], capital, fee, assetSize, netRevenue,
                profit, cumProfit: profit === null ? null : cumProfit, cumSold, avg: cumRevenue / cumSold };
        });
    };

    Calculator.createPlan = (settings) => {
        const { C, currentPrice, N, S, spacingMode, buyPriceEnd, sellPriceEnd, tradingMode } = settings;
        const sellOnly = tradingMode === 'sell-only';
        const buyOnly = tradingMode === 'buy-only';
        const weights = Calculator.integrateSkewWeights(N, S);
        const buyPrices = prices(currentPrice, buyPriceEnd, N, spacingMode);
        const targetAvg = Calculator.computeTargetAvgBuy({ skewValue: S, currentPrice, buyPriceEnd, spacingMode });
        const buyWeights = S === 0 ? weights : Calculator.adjustWeightsToTargetAvg(weights, buyPrices, targetAvg);
        const buyLadder = sellOnly ? [] : buildBuys(settings, buyWeights, buyPrices);
        const quantity = sellOnly ? C : sum(buyLadder, 'assetSize');
        const cost = sellOnly ? (settings.existingAvgPrice === null ? null : C * settings.existingAvgPrice)
            : sum(buyLadder, 'capital');
        const weightTotal = weights.reduce((a, b) => a + b, 0);
        const quantities = sellOnly ? weights.map(w => C * (w / weightTotal)) : buyLadder.map(r => r.assetSize);
        const costPerUnit = cost === null ? null : cost / quantity;
        const sellLadder = buyOnly ? [] : buildSells(settings, quantities,
            prices(currentPrice, sellPriceEnd, N, spacingMode), costPerUnit);
        const sellFees = sum(sellLadder, 'fee');
        const netProfit = buyOnly || cost === null ? null : sum(sellLadder, 'capital') - sellFees - cost;
        const summary = {
            netProfit, roi: netProfit === null || !(cost > 0) ? null : netProfit / cost * 100,
            avgBuy: sellOnly ? settings.existingAvgPrice : sum(buyLadder, 'netCapital') / quantity,
            avgSell: buyOnly ? null : sum(sellLadder, 'netRevenue') / quantity,
            totalFees: sum(buyLadder, 'fee') + sellFees, totalQuantity: quantity,
            rangeLow: buyPriceEnd, rangeHigh: sellPriceEnd,
            buyTotalValue: sum(buyLadder, 'capital'), buyTotalVolume: sum(buyLadder, 'assetSize'),
            sellTotalValue: sum(sellLadder, 'capital'), sellTotalVolume: sum(sellLadder, 'assetSize')
        };
        return { buyLadder, sellLadder, summary };
    };
})();
