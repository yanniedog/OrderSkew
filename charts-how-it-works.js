// OrderSkew - How It Works modal chart (depends on d3; loaded after charts.js or with it)
/**
 * Draw simplified vertical bar chart for "How It Works" modal
 * Shows smaller bars near current price, larger bars at extremes
 * Matches main page chart style: vertical orientation with price on Y-axis
 */
function drawHowItWorksChart(selector, currentPrice, showValue) {
    if (currentPrice == null) currentPrice = 100;
    if (showValue == null) showValue = false;
    const svgSel = d3.select(selector);
    const svgNode = svgSel.node();
    if (!svgNode) return;

    const container = svgNode.parentNode;
    if (!container) return;

    svgSel.selectAll("*").remove();

    const width = container.clientWidth || 300;
    const height = container.clientHeight || 160;
    const margin = { top: 15, right: 10, bottom: 30, left: 50 };

    const svg = svgSel
        .attr("width", width)
        .attr("height", height);

    const N = 8;
    const depth = 0.20;
    const buyPriceEnd = currentPrice * (1 - depth);
    const sellPriceEnd = currentPrice * (1 + depth);
    const buyStep = (currentPrice - buyPriceEnd) / N;
    const sellStep = (sellPriceEnd - currentPrice) / N;

    const buyPrices = Array.from({ length: N }, function (_, i) { return currentPrice - ((i + 1) * buyStep); });
    const sellPrices = Array.from({ length: N }, function (_, i) { return currentPrice + ((i + 1) * sellStep); });

    const baseVolume = 8;
    const skewFactor = 2.5;

    const buyVolumes = buyPrices.map(function (price) {
        const distanceRatio = (currentPrice - price) / currentPrice;
        const normalizedDistance = distanceRatio / depth;
        return baseVolume * (1 + normalizedDistance * skewFactor);
    });

    const sellVolumes = sellPrices.map(function (price) {
        const distanceRatio = (price - currentPrice) / currentPrice;
        const normalizedDistance = distanceRatio / depth;
        return baseVolume * (1 + normalizedDistance * skewFactor);
    });

    const buyData = buyPrices.map(function (price, i) {
        return {
            price: price,
            assetSize: buyVolumes[i],
            volume: buyVolumes[i],
            netCapital: price * buyVolumes[i],
            value: price * buyVolumes[i],
            isBuy: true,
            rung: i + 1
        };
    });

    const sellData = sellPrices.map(function (price, i) {
        return {
            price: price,
            assetSize: sellVolumes[i],
            volume: sellVolumes[i],
            netRevenue: price * sellVolumes[i],
            value: price * sellVolumes[i],
            isBuy: false,
            rung: i + 1
        };
    });

    const allData = buyData.concat(sellData);
    if (!allData.length) return;

    const sortedBuyData = buyData.slice().sort(function (a, b) { return b.price - a.price; });
    const sortedSellData = sellData.slice().sort(function (a, b) { return a.price - b.price; });

    const prices = allData.map(function (d) { return d.price; });
    const yMin = d3.min(prices);
    const yMax = d3.max(prices);
    const priceExtent = yMax - yMin || 1;
    const paddedMin = yMin - priceExtent * 0.05;
    const paddedMax = yMax + priceExtent * 0.05;

    const y = d3.scaleLinear()
        .domain([paddedMin, paddedMax])
        .range([height - margin.bottom, margin.top]);

    const computeCumulatives = function (series) {
        var cum = 0;
        series.forEach(function (d) {
            var val = showValue ? d.value : d.volume;
            cum += val;
            d.individualVal = val;
            d.cumulativeVal = cum;
        });
    };

    computeCumulatives(sortedBuyData);
    computeCumulatives(sortedSellData);

    const maxIndividual = showValue
        ? d3.max(allData, function (d) { return d.value; })
        : d3.max(allData, function (d) { return d.volume; });
    const maxCumulative = d3.max(sortedBuyData.concat(sortedSellData), function (d) { return d.cumulativeVal; });
    const maxValue = Math.max(maxIndividual || 1, maxCumulative || 1);
    const x = d3.scaleLinear()
        .domain([0, maxValue * 1.1])
        .range([margin.left, width - margin.right]);

    const chartHeight = height - margin.top - margin.bottom;
    const totalBars = allData.length;
    const barPadding = 0.15;
    const barHeight = Math.min(chartHeight / (totalBars + 1), 12);
    const effectiveBarHeight = barHeight * (1 - barPadding);

    const areaGroup = svg.append("g").attr("class", "howitworks-cumulative");
    const barsGroup = svg.append("g").attr("class", "bars-layer");

    const drawCumulativeRects = function (series, colorVar) {
        if (!series.length) return;
        const fill = getComputedStyle(document.body).getPropertyValue(colorVar).trim() || "rgba(0,0,0,0.2)";
        var cls = colorVar.indexOf("buy") !== -1 ? "cum-buy" : "cum-sell";
        areaGroup.selectAll("." + cls)
            .data(series)
            .enter()
            .append("rect")
            .attr("class", cls)
            .attr("x", margin.left)
            .attr("y", function (d) { return y(d.price) - effectiveBarHeight / 2; })
            .attr("width", function (d) { return Math.max(0, x(d.cumulativeVal) - margin.left); })
            .attr("height", effectiveBarHeight)
            .attr("fill", fill)
            .attr("opacity", 0.25)
            .attr("rx", 2);
    };

    drawCumulativeRects(sortedBuyData, "--color-chart-buy-area");
    drawCumulativeRects(sortedSellData, "--color-chart-sell-area");

    const buyColor = getComputedStyle(document.body).getPropertyValue("--color-chart-buy-start").trim() || "#ef4444";
    const sellColor = getComputedStyle(document.body).getPropertyValue("--color-chart-sell-start").trim() || "#22c55e";

    barsGroup.selectAll(".buy-bar")
        .data(sortedBuyData)
        .enter()
        .append("rect")
        .attr("class", "buy-bar")
        .attr("x", margin.left)
        .attr("y", function (d) { return y(d.price) - effectiveBarHeight / 2; })
        .attr("width", 0)
        .attr("height", effectiveBarHeight)
        .attr("fill", buyColor)
        .attr("opacity", 0.7)
        .attr("rx", 2)
        .transition()
        .duration(600)
        .attr("width", function (d) { return Math.max(0, x(showValue ? d.value : d.volume) - margin.left); });

    barsGroup.selectAll(".sell-bar")
        .data(sortedSellData)
        .enter()
        .append("rect")
        .attr("class", "sell-bar")
        .attr("x", margin.left)
        .attr("y", function (d) { return y(d.price) - effectiveBarHeight / 2; })
        .attr("width", 0)
        .attr("height", effectiveBarHeight)
        .attr("fill", sellColor)
        .attr("opacity", 0.7)
        .attr("rx", 2)
        .transition()
        .duration(600)
        .attr("width", function (d) { return Math.max(0, x(showValue ? d.value : d.volume) - margin.left); });

    if (!showValue || (buyData.length > 0 && sellData.length > 0)) {
        svg.append("line")
            .attr("x1", margin.left)
            .attr("x2", width - margin.right)
            .attr("y1", y(currentPrice))
            .attr("y2", y(currentPrice))
            .attr("stroke", "currentColor")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4 2")
            .attr("opacity", 0.3);
    }

    const yAxis = d3.axisLeft(y)
        .ticks(Math.min(totalBars, 8))
        .tickFormat(function (d) { return "$" + d3.format(",.0f")(d); });

    svg.append("g")
        .attr("transform", "translate(" + margin.left + ",0)")
        .call(yAxis)
        .attr("class", "text-[9px] opacity-60")
        .call(function (g) { g.selectAll("path").attr("stroke", "var(--color-border-strong)"); })
        .call(function (g) { g.selectAll("line").attr("stroke", "var(--color-border)"); });

    const xAxis = d3.axisBottom(x)
        .ticks(4)
        .tickFormat(function (d) {
            return showValue ? "$" + d3.format(".2s")(d) : d3.format(".2s")(d);
        });

    svg.append("g")
        .attr("transform", "translate(0," + (height - margin.bottom) + ")")
        .call(xAxis)
        .attr("class", "text-[9px] opacity-60")
        .call(function (g) { g.selectAll("path").attr("stroke", "var(--color-border-strong)"); })
        .call(function (g) { g.selectAll("line").remove(); });

    const unitLabel = showValue ? "Value ($)" : "Volume";
    svg.append("text")
        .attr("x", (width + margin.left - margin.right) / 2)
        .attr("y", height - 8)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .attr("font-size", "9px")
        .attr("class", "opacity-50")
        .text(unitLabel);

    const priceLineGroup = svg.append("g").attr("class", "price-annotation");
    priceLineGroup.append("text")
        .attr("x", margin.left + 3)
        .attr("y", y(currentPrice) - 4)
        .attr("fill", "var(--color-text-muted)")
        .attr("font-size", "8px")
        .attr("opacity", 0.7)
        .text("Current");

    if (!showValue) {
        const arrowGroup = svg.append("g").attr("class", "skew-arrows opacity-40");
        if (sortedBuyData.length > 0) {
            const lastBuyBar = sortedBuyData[sortedBuyData.length - 1];
            const arrowY = y(lastBuyBar.price);
            arrowGroup.append("path")
                .attr("d", "M" + (width - margin.right - 5) + "," + arrowY + " l-8,4 l0,-8 z")
                .attr("fill", buyColor)
                .attr("opacity", 0.5);
        }
        if (sortedSellData.length > 0) {
            const lastSellBar = sortedSellData[sortedSellData.length - 1];
            const arrowY = y(lastSellBar.price);
            arrowGroup.append("path")
                .attr("d", "M" + (width - margin.right - 5) + "," + arrowY + " l-8,4 l0,-8 z")
                .attr("fill", sellColor)
                .attr("opacity", 0.5);
        }
    }
}

window.drawHowItWorksChart = drawHowItWorksChart;
