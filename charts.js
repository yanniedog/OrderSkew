// OrderSkew - D3 Chart Module (charts.js)

/**
 * Combined bar chart with cumulative area overlay:
 *  - Horizontal bars for each individual order
 *  - Cumulative area showing running total
 *  - Both layers can be toggled on/off
 *  - In sell-only mode, only shows sell orders
 *  - In buy-only mode, only shows buy orders
 */
function drawDepthChart(selector, buys, sells, avgBuyPrice = null, avgSellPrice = null) {
    const svgSel = d3.select(selector);
    const svgNode = svgSel.node();
    if (!svgNode) return;

    const container = svgNode.parentNode;
    if (!container || (!buys?.length && !sells?.length)) return;

    svgSel.selectAll("*").remove();

    const width  = container.clientWidth;
    const height = container.clientHeight;
    const margin = { top: 20, right: 50, bottom: 40, left: 55 };

    const svg = svgSel
        .attr("width", width)
        .attr("height", height);

    // Get display modes from State
    const showBars = State.chartShowBars;
    const showCumulative = State.chartShowCumulative;
    const isValue = State.chartUnitType === 'value';
    const isSellOnly = State.tradingMode === 'sell-only';
    const isBuyOnly = State.tradingMode === 'buy-only';

    // Prepare data and compute cumulative values
    const computeCumulatives = (series, valKey) => {
        let cumQty = 0, cumVal = 0;
        series.forEach(d => {
            const qty = d.assetSize ?? d.qty ?? d.size ?? d.volume ?? 0;
            const val = d[valKey] ?? d.capital ?? (qty * d.price) ?? 0;
            d.individualQty = qty; d.individualVal = val;
            cumQty += qty; cumVal += val;
            d.cumulativeQty = cumQty; d.cumulativeVal = cumVal;
        });
    };
    
    const buySeries = isSellOnly ? [] : (buys || []).slice().sort((a, b) => b.price - a.price);
    const sellSeries = isBuyOnly ? [] : (sells || []).slice().sort((a, b) => a.price - b.price);
    computeCumulatives(buySeries, 'netCapital');
    computeCumulatives(sellSeries, 'netRevenue');

    // Value accessors
    const getIndividualValue = (d) => isValue ? d.individualVal : d.individualQty;
    const getCumulativeValue = (d) => isValue ? d.cumulativeVal : d.cumulativeQty;

    const allData = [...buySeries, ...sellSeries];
    if (!allData.length) return;

    // Calculate price range
    const prices = allData.map(d => d.price);
    const yMin = d3.min(prices);
    const yMax = d3.max(prices);
    const mid = (yMin + yMax) / 2;

    // Calculate bar heights based on number of orders and available space
    const chartHeight = height - margin.top - margin.bottom;
    const totalBars = buySeries.length + sellSeries.length;
    const barPadding = 0.15;
    const barHeight = Math.min(chartHeight / (totalBars + 1), 25);
    const effectiveBarHeight = barHeight * (1 - barPadding);

    // Build price scale
    const priceExtent = yMax - yMin || 1;
    const paddedMin = yMin - priceExtent * 0.05;
    const paddedMax = yMax + priceExtent * 0.05;

    const y = d3.scaleLinear()
        .domain([paddedMin, paddedMax])
        .range([height - margin.bottom, margin.top]);

    // X scale - account for both individual and cumulative max
    const maxIndividual = d3.max(allData, getIndividualValue) || 1;
    const maxCumulative = d3.max(allData, getCumulativeValue) || 1;
    const maxValue = Math.max(maxIndividual, showCumulative ? maxCumulative : 0);

    const x = d3.scaleLinear()
        .domain([0, maxValue * 1.1])
        .range([margin.left, width - margin.right]);

    // Mid price label
    const midLabel = document.getElementById("mid-price-label");
    if (midLabel) {
        if (isSellOnly) {
            midLabel.textContent = 'Sell Ladder';
        } else if (isBuyOnly) {
            midLabel.textContent = 'Buy Ladder';
        } else {
            midLabel.textContent = `Mid ≈ ${Utils.fmtCurr(mid)}`;
        }
    }

    // Create layer groups - areaGroup first so it renders behind bars
    const areaGroup = svg.append("g").attr("class", "cumulative-layer");
    const barsGroup = svg.append("g").attr("class", "bars-layer");
    const avgLinesGroup = svg.append("g").attr("class", "avg-lines-layer");

    // Draw cumulative areas if enabled (draw first so they appear behind bars)
    if (showCumulative) {
        const drawCumulativeArea = (series, areaClass, colorVar) => {
            if (!series.length) return;
            const color = getComputedStyle(document.body).getPropertyValue(colorVar).trim();
            
            // Manually construct the area path to ensure left edge always starts at margin.left
            // Create a stepped area: each segment is a rectangle from margin.left to cumulative value
            let pathData = [];
            
            for (let i = 0; i < series.length; i++) {
                const d = series[i];
                const yTop = y(d.price) - effectiveBarHeight / 2;
                const yBottom = y(d.price) + effectiveBarHeight / 2;
                const xRight = x(getCumulativeValue(d));
                
                if (i === 0) {
                    // Start at top-left of first segment
                    pathData.push(`M ${margin.left} ${yTop}`);
                } else {
                    // From previous segment's bottom-left, step up to current top
                    const prevD = series[i - 1];
                    const prevYBottom = y(prevD.price) + effectiveBarHeight / 2;
                    pathData.push(`L ${margin.left} ${prevYBottom}`);
                    pathData.push(`L ${margin.left} ${yTop}`);
                }
                
                // Draw rectangle for this segment: top-right -> bottom-right -> bottom-left
                pathData.push(`L ${xRight} ${yTop}`);      // Extend right
                pathData.push(`L ${xRight} ${yBottom}`);   // Step down
                pathData.push(`L ${margin.left} ${yBottom}`); // Back to left
            }
            
            // Close the path back to start
            if (series.length > 0) {
                const firstYTop = y(series[0].price) - effectiveBarHeight / 2;
                pathData.push(`L ${margin.left} ${firstYTop}`);
                pathData.push('Z');
            }
            
            areaGroup.append("path")
                .attr("class", areaClass)
                .attr("fill", color)
                .attr("opacity", 0.4)
                .attr("d", pathData.join(' '));
        };
        drawCumulativeArea(buySeries, "buy-cum-area", "--color-chart-buy-area");
        drawCumulativeArea(sellSeries, "sell-cum-area", "--color-chart-sell-area");
    }

    // Draw bars if enabled
    if (showBars) {
        const drawBars = (series, className, colorVar) => {
            if (!series.length) return;
            barsGroup.selectAll(`.${className}`)
                .data(series).enter().append("rect")
                .attr("class", className)
                .attr("x", margin.left)
                .attr("y", d => y(d.price) - effectiveBarHeight / 2)
                .attr("width", 0).attr("height", effectiveBarHeight)
                .attr("fill", getComputedStyle(document.body).getPropertyValue(colorVar).trim())
                .attr("opacity", 0.7).attr("rx", 2)
                .transition().duration(600)
                .attr("width", d => Math.max(0, x(getIndividualValue(d)) - margin.left));
        };
        drawBars(buySeries, "buy-bar", "--color-chart-buy-start");
        drawBars(sellSeries, "sell-bar", "--color-chart-sell-start");
    }

    // Mid price line (only show in buy+sell mode)
    if (!isSellOnly && !isBuyOnly) {
        svg.append("line")
            .attr("x1", margin.left)
            .attr("x2", width - margin.right)
            .attr("y1", y(mid))
            .attr("y2", y(mid))
            .attr("stroke", "currentColor")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "4 2")
            .attr("opacity", 0.3);
    }

    // Average entry price line (white line, shown in all modes when avgBuyPrice is available)
    // Works in both Volume and Value ($) modes since it's positioned on the price (Y) axis
    if (avgBuyPrice !== null && Number.isFinite(avgBuyPrice) && avgBuyPrice > 0) {
        const avgY = y(avgBuyPrice);
        // Only draw if the average price is within the visible range
        if (avgY >= margin.top && avgY <= height - margin.bottom) {
            avgLinesGroup.append("line")
                .attr("x1", margin.left)
                .attr("x2", width - margin.right)
                .attr("y1", avgY)
                .attr("y2", avgY)
                .attr("stroke", "white")
                .attr("stroke-width", 2)
                .attr("opacity", 0.9)
                .attr("class", "avg-entry-line");
        }
    }

    // Average sell price line (white line, shown in buy+sell mode when avgSellPrice is available)
    // Works in both Volume and Value ($) modes since it's positioned on the price (Y) axis
    if (!isSellOnly && !isBuyOnly && avgSellPrice !== null && Number.isFinite(avgSellPrice) && avgSellPrice > 0) {
        const avgSellY = y(avgSellPrice);
        // Only draw if the average price is within the visible range
        if (avgSellY >= margin.top && avgSellY <= height - margin.bottom) {
            avgLinesGroup.append("line")
                .attr("x1", margin.left)
                .attr("x2", width - margin.right)
                .attr("y1", avgSellY)
                .attr("y2", avgSellY)
                .attr("stroke", "white")
                .attr("stroke-width", 2)
                .attr("opacity", 0.9)
                .attr("class", "avg-sell-line");
        }
    }

    // Y-axis (Price) - use actual bar prices so ticks align with bar centers
    const allPrices = allData.map(d => d.price).sort((a, b) => a - b);
    // Remove duplicates
    const uniquePrices = [...new Set(allPrices)];
    
    // If too many prices, show every Nth one but always include first and last
    const maxTicks = 10;
    let tickValues;
    if (uniquePrices.length <= maxTicks) {
        tickValues = uniquePrices;
    } else {
        const step = Math.ceil(uniquePrices.length / maxTicks);
        tickValues = uniquePrices.filter((_, i) => i % step === 0);
        // Ensure first and last are included
        if (!tickValues.includes(uniquePrices[0])) tickValues.unshift(uniquePrices[0]);
        if (!tickValues.includes(uniquePrices[uniquePrices.length - 1])) tickValues.push(uniquePrices[uniquePrices.length - 1]);
    }
    
    const yAxis = d3.axisLeft(y)
        .tickValues(tickValues)
        .tickFormat(d => "$" + d3.format(",.0f")(d));

    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(yAxis)
        .attr("class", "text-[10px]")
        .call(g => g.selectAll("path").attr("stroke", "var(--color-border-strong)"))
        .call(g => g.selectAll("line").attr("stroke", "var(--color-border)").attr("opacity", 0.3))
        .call(g => g.selectAll("text").attr("fill", "var(--color-text-secondary)"));

    // X-axis
    const xAxis = d3.axisBottom(x)
        .ticks(6)
        .tickFormat(d => isValue ? "$" + d3.format(",.0f")(d) : d3.format(",.0f")(d));

    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(xAxis)
        .attr("class", "text-[10px]")
        .call(g => g.selectAll("path").attr("stroke", "var(--color-border-strong)"))
        .call(g => g.selectAll("line").remove())
        .call(g => g.selectAll("text").attr("fill", "var(--color-text-secondary)"));

    // X-axis label
    const unitLabel = isValue ? "Value ($)" : "Volume";
    svg.append("text")
        .attr("x", (width + margin.left - margin.right) / 2)
        .attr("y", height - 5)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .attr("font-size", "9px")
        .attr("class", "opacity-50")
        .text(unitLabel);

    // Tooltip and hover zones
    const tooltip = d3.select("#tooltip");
    const allBarsData = [
        ...buySeries.map(d => ({ ...d, isBuy: true })),
        ...sellSeries.map(d => ({ ...d, isBuy: false }))
    ];

    svg.selectAll(".hover-zone")
        .data(allBarsData)
        .enter()
        .append("rect")
        .attr("class", "hover-zone")
        .attr("x", margin.left)
        .attr("y", d => y(d.price) - effectiveBarHeight / 2 - 2)
        .attr("width", width - margin.left - margin.right)
        .attr("height", effectiveBarHeight + 4)
        .attr("fill", "transparent")
        .style("cursor", "crosshair")
        .on("mouseenter", function(event, d) {
            // Highlight bar
            if (showBars) {
                const barClass = d.isBuy ? ".buy-bar" : ".sell-bar";
                barsGroup.selectAll(barClass)
                    .filter(bd => bd.price === d.price)
                    .attr("opacity", 1)
                    .attr("stroke", d.isBuy ? "#dc2626" : "#16a34a")
                    .attr("stroke-width", 2);
            }

            // Highlight cumulative area
            if (showCumulative) {
                const areaClass = d.isBuy ? ".buy-cum-area" : ".sell-cum-area";
                areaGroup.selectAll(areaClass)
                    .attr("opacity", 0.6);
            }

            // Show tooltip
            const cumulativeLabel = d.isBuy ? "If Filled To This Rung:" : "Cumulative:";
            const qtyLabel = d.isBuy ? "Qty" : "Vol";
            const avgBuyLine = d.isBuy && Number.isFinite(d.avg) && d.avg > 0
                ? `<div>Avg Buy: ${Utils.fmtCurr(d.avg)}</div>`
                : '';
            const html = `
                <div class="font-bold ${d.isBuy ? "text-red-400" : "text-green-400"}">
                    ${d.isBuy ? "Buy" : "Sell"} Order #${d.rung}
                </div>
                <div>Price: ${Utils.fmtCurr(d.price)}</div>
                <div class="border-t border-gray-600 mt-1 pt-1">
                    <div class="text-gray-400 text-[10px] mb-1">Individual:</div>
                    <div>Vol: ${Utils.fmtNum(d.individualQty, 4)}</div>
                    <div>Val: ${Utils.fmtCurr(d.individualVal)}</div>
                </div>
                <div class="border-t border-gray-600 mt-1 pt-1">
                    <div class="text-gray-400 text-[10px] mb-1">${cumulativeLabel}</div>
                    <div>${qtyLabel}: ${Utils.fmtNum(d.cumulativeQty, 4)}</div>
                    <div>Val: ${Utils.fmtCurr(d.cumulativeVal)}</div>
                    ${avgBuyLine}
                </div>
            `;

            tooltip.classed("hidden", false).style("opacity", 1).html(html);

            const box = tooltip.node().getBoundingClientRect();
            let left = event.pageX + 15;
            if (left + box.width > window.innerWidth) left = event.pageX - box.width - 15;
            tooltip.style("left", left + "px").style("top", (event.pageY - 40) + "px");

            // Cursor line
            svg.selectAll(".cursor-line").remove();
            svg.append("line")
                .attr("class", "cursor-line")
                .attr("x1", margin.left)
                .attr("x2", width - margin.right)
                .attr("y1", y(d.price))
                .attr("y2", y(d.price))
                .attr("stroke", d.isBuy ? "#dc2626" : "#16a34a")
                .attr("stroke-width", 1)
                .attr("stroke-dasharray", "4 4")
                .attr("opacity", 0.8);
        })
        .on("mousemove", function(event) {
            const box = tooltip.node().getBoundingClientRect();
            let left = event.pageX + 15;
            if (left + box.width > window.innerWidth) left = event.pageX - box.width - 15;
            tooltip.style("left", left + "px").style("top", (event.pageY - 40) + "px");
        })
        .on("mouseleave", function(event, d) {
            if (showBars) {
                const barClass = d.isBuy ? ".buy-bar" : ".sell-bar";
                barsGroup.selectAll(barClass)
                    .filter(bd => bd.price === d.price)
                    .attr("opacity", 0.7)
                    .attr("stroke", "none");
            }
            if (showCumulative) {
                const areaClass = d.isBuy ? ".buy-cum-area" : ".sell-cum-area";
                areaGroup.selectAll(areaClass)
                    .attr("opacity", 0.4);
            }
            tooltip.classed("hidden", true).style("opacity", 0);
            svg.selectAll(".cursor-line").remove();
        });
}

// Expose to global scope
window.drawDepthChart = drawDepthChart;

/**
 * Draw simplified vertical bar chart for "How It Works" modal
 * Shows smaller bars near current price, larger bars at extremes
 * Matches main page chart style: vertical orientation with price on Y-axis
 */
function drawHowItWorksChart(selector, currentPrice = 100, showValue = false) {
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

    // Generate example data: 8 buy orders and 8 sell orders
    // Match main page structure with proper skew (smaller near price, larger at extremes)
    const N = 8;
    const depth = 0.20; // 20% depth
    const buyPriceEnd = currentPrice * (1 - depth);
    const sellPriceEnd = currentPrice * (1 + depth);
    const buyStep = (currentPrice - buyPriceEnd) / N;
    const sellStep = (sellPriceEnd - currentPrice) / N;

    // Generate prices
    const buyPrices = Array.from({ length: N }, (_, i) => currentPrice - ((i + 1) * buyStep));
    const sellPrices = Array.from({ length: N }, (_, i) => currentPrice + ((i + 1) * sellStep));

    // Generate volumes with smaller bars near price, larger at extremes (skewed allocation)
    // Use similar logic to main chart: smaller volume near current price, larger at extremes
    const baseVolume = 8;
    const skewFactor = 2.5; // How much larger bars get at extremes
    
    const buyVolumes = buyPrices.map((price) => {
        const distanceRatio = (currentPrice - price) / currentPrice; // 0 to depth
        const normalizedDistance = distanceRatio / depth; // 0 to 1
        // Smaller near price (0), larger at extremes (1)
        return baseVolume * (1 + normalizedDistance * skewFactor);
    });
    
    const sellVolumes = sellPrices.map((price) => {
        const distanceRatio = (price - currentPrice) / currentPrice;
        const normalizedDistance = distanceRatio / depth;
        return baseVolume * (1 + normalizedDistance * skewFactor);
    });

    // Combine all data - match main chart structure
    const buyData = buyPrices.map((price, i) => ({
        price,
        assetSize: buyVolumes[i],
        volume: buyVolumes[i],
        netCapital: price * buyVolumes[i],
        value: price * buyVolumes[i],
        isBuy: true,
        rung: i + 1
    }));

    const sellData = sellPrices.map((price, i) => ({
        price,
        assetSize: sellVolumes[i],
        volume: sellVolumes[i],
        netRevenue: price * sellVolumes[i],
        value: price * sellVolumes[i],
        isBuy: false,
        rung: i + 1
    }));

    const allData = [...buyData, ...sellData];
    if (!allData.length) return;

    // Sort data - buy by price descending, sell by price ascending (matching main chart)
    const sortedBuyData = [...buyData].sort((a, b) => b.price - a.price);
    const sortedSellData = [...sellData].sort((a, b) => a.price - b.price);

    // Calculate price range
    const prices = allData.map(d => d.price);
    const yMin = d3.min(prices);
    const yMax = d3.max(prices);
    const priceExtent = yMax - yMin || 1;
    const paddedMin = yMin - priceExtent * 0.05;
    const paddedMax = yMax + priceExtent * 0.05;

    // Y scale (price on vertical axis) - matches main chart
    const y = d3.scaleLinear()
        .domain([paddedMin, paddedMax])
        .range([height - margin.bottom, margin.top]);

    // X scale - use value or volume based on showValue parameter
    const computeCumulatives = (series) => {
        let cum = 0;
        series.forEach(d => {
            const val = showValue ? d.value : d.volume;
            cum += val;
            d.individualVal = val;
            d.cumulativeVal = cum;
        });
    };

    computeCumulatives(sortedBuyData);
    computeCumulatives(sortedSellData);

    const maxIndividual = showValue 
        ? d3.max(allData, d => d.value) 
        : d3.max(allData, d => d.volume);
    const maxCumulative = d3.max([...sortedBuyData, ...sortedSellData], d => d.cumulativeVal);
    const maxValue = Math.max(maxIndividual || 1, maxCumulative || 1);
    const x = d3.scaleLinear()
        .domain([0, maxValue * 1.1])
        .range([margin.left, width - margin.right]);

    // Calculate bar heights - match main chart style
    const chartHeight = height - margin.top - margin.bottom;
    const totalBars = allData.length;
    const barPadding = 0.15;
    const barHeight = Math.min(chartHeight / (totalBars + 1), 12);
    const effectiveBarHeight = barHeight * (1 - barPadding);

    // Draw cumulative areas then bars
    const areaGroup = svg.append("g").attr("class", "howitworks-cumulative");
    const barsGroup = svg.append("g").attr("class", "bars-layer");

    const drawCumulativeRects = (series, colorVar) => {
        if (!series.length) return;
        const fill = getComputedStyle(document.body).getPropertyValue(colorVar).trim() || "rgba(0,0,0,0.2)";
        areaGroup.selectAll(`.cum-${colorVar}`)
            .data(series)
            .enter()
            .append("rect")
            .attr("x", margin.left)
            .attr("y", d => y(d.price) - effectiveBarHeight / 2)
            .attr("width", d => Math.max(0, x(d.cumulativeVal) - margin.left))
            .attr("height", effectiveBarHeight)
            .attr("fill", fill)
            .attr("opacity", 0.25)
            .attr("rx", 2);
    };

    drawCumulativeRects(sortedBuyData, "--color-chart-buy-area");
    drawCumulativeRects(sortedSellData, "--color-chart-sell-area");

    // Get colors from CSS variables (matching main chart)
    const buyColor = getComputedStyle(document.body).getPropertyValue("--color-chart-buy-start").trim() || "#ef4444";
    const sellColor = getComputedStyle(document.body).getPropertyValue("--color-chart-sell-start").trim() || "#22c55e";

    // Buy bars (red) - sorted by price descending
    barsGroup.selectAll(".buy-bar")
        .data(sortedBuyData)
        .enter()
        .append("rect")
        .attr("class", "buy-bar")
        .attr("x", margin.left)
        .attr("y", d => y(d.price) - effectiveBarHeight / 2)
        .attr("width", 0)
        .attr("height", effectiveBarHeight)
        .attr("fill", buyColor)
        .attr("opacity", 0.7)
        .attr("rx", 2)
        .transition()
        .duration(600)
        .attr("width", d => Math.max(0, x(showValue ? d.value : d.volume) - margin.left));

    // Sell bars (green) - sorted by price ascending
    barsGroup.selectAll(".sell-bar")
        .data(sortedSellData)
        .enter()
        .append("rect")
        .attr("class", "sell-bar")
        .attr("x", margin.left)
        .attr("y", d => y(d.price) - effectiveBarHeight / 2)
        .attr("width", 0)
        .attr("height", effectiveBarHeight)
        .attr("fill", sellColor)
        .attr("opacity", 0.7)
        .attr("rx", 2)
        .transition()
        .duration(600)
        .attr("width", d => Math.max(0, x(showValue ? d.value : d.volume) - margin.left));

    // Current price line (only show in buy+sell mode)
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

    // Y-axis (Price) - matches main chart styling
    const yAxis = d3.axisLeft(y)
        .ticks(Math.min(totalBars, 8))
        .tickFormat(d => "$" + d3.format(",.0f")(d));

    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(yAxis)
        .attr("class", "text-[9px] opacity-60")
        .call(g => g.selectAll("path").attr("stroke", "var(--color-border-strong)"))
        .call(g => g.selectAll("line").attr("stroke", "var(--color-border)"));

    // X-axis - matches main chart styling
    const xAxis = d3.axisBottom(x)
        .ticks(4)
        .tickFormat(d => showValue 
            ? "$" + d3.format(".2s")(d) 
            : d3.format(".2s")(d));

    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(xAxis)
        .attr("class", "text-[9px] opacity-60")
        .call(g => g.selectAll("path").attr("stroke", "var(--color-border-strong)"))
        .call(g => g.selectAll("line").remove());

    // X-axis label
    const unitLabel = showValue ? "Value ($)" : "Volume";
    svg.append("text")
        .attr("x", (width + margin.left - margin.right) / 2)
        .attr("y", height - 8)
        .attr("fill", "currentColor")
        .attr("text-anchor", "middle")
        .attr("font-size", "9px")
        .attr("class", "opacity-50")
        .text(unitLabel);

    // Add current price annotation line with label
    const priceLineGroup = svg.append("g").attr("class", "price-annotation");
    
    priceLineGroup.append("text")
        .attr("x", margin.left + 3)
        .attr("y", y(currentPrice) - 4)
        .attr("fill", "var(--color-text-muted)")
        .attr("font-size", "8px")
        .attr("opacity", 0.7)
        .text("Current");

    // Add subtle skew indicator arrows for the bars
    if (!showValue) {
        // Volume mode - show arrows indicating bar size increases away from price
        const arrowGroup = svg.append("g").attr("class", "skew-arrows opacity-40");
        
        // Arrow pointing to larger buy bars at bottom
        if (sortedBuyData.length > 0) {
            const lastBuyBar = sortedBuyData[sortedBuyData.length - 1];
            const arrowY = y(lastBuyBar.price);
            arrowGroup.append("path")
                .attr("d", `M${width - margin.right - 5},${arrowY} l-8,4 l0,-8 z`)
                .attr("fill", buyColor)
                .attr("opacity", 0.5);
        }
        
        // Arrow pointing to larger sell bars at top
        if (sortedSellData.length > 0) {
            const lastSellBar = sortedSellData[sortedSellData.length - 1];
            const arrowY = y(lastSellBar.price);
            arrowGroup.append("path")
                .attr("d", `M${width - margin.right - 5},${arrowY} l-8,4 l0,-8 z`)
                .attr("fill", sellColor)
                .attr("opacity", 0.5);
        }
    }
}

// Expose to global scope
window.drawHowItWorksChart = drawHowItWorksChart;
