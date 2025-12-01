// OrderSkew - D3 Chart Module (charts.js)

/**
 * Combined bar chart with cumulative line overlay:
 *  - Horizontal bars for each individual order
 *  - Cumulative line showing running total
 *  - Both layers can be toggled on/off
 *  - In sell-only mode, only shows sell orders
 *  - In buy-only mode, only shows buy orders
 */
function drawDepthChart(selector, buys, sells) {
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

    // Create layer groups
    const barsGroup = svg.append("g").attr("class", "bars-layer");
    const lineGroup = svg.append("g").attr("class", "cumulative-layer");

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

    // Draw cumulative lines if enabled
    if (showCumulative) {
        const lineGenerator = d3.line().x(d => x(getCumulativeValue(d))).y(d => y(d.price)).curve(d3.curveStepAfter);
        const drawCumulativeLine = (series, dotClass, colorVar) => {
            if (!series.length) return;
            const color = getComputedStyle(document.body).getPropertyValue(colorVar).trim();
            lineGroup.append("path").datum(series)
                .attr("fill", "none").attr("stroke", color)
                .attr("stroke-width", 2.5).attr("stroke-dasharray", "6 3")
                .attr("opacity", 0.9).attr("d", lineGenerator);
            lineGroup.selectAll(`.${dotClass}`).data(series).enter().append("circle")
                .attr("class", dotClass)
                .attr("cx", d => x(getCumulativeValue(d))).attr("cy", d => y(d.price))
                .attr("r", 4).attr("fill", color).attr("stroke", "white").attr("stroke-width", 1.5);
        };
        drawCumulativeLine(buySeries, "buy-cum-dot", "--color-chart-buy-start");
        drawCumulativeLine(sellSeries, "sell-cum-dot", "--color-chart-sell-start");
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

    // Y-axis (Price)
    const yAxis = d3.axisLeft(y)
        .ticks(Math.min(totalBars, 10))
        .tickFormat(d => "$" + d3.format(",.0f")(d));

    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(yAxis)
        .attr("class", "text-[9px] opacity-60")
        .call(g => g.selectAll("path").attr("stroke", "var(--color-border-strong)"))
        .call(g => g.selectAll("line").attr("stroke", "var(--color-border)"));

    // X-axis
    const xAxis = d3.axisBottom(x)
        .ticks(5)
        .tickFormat(d => isValue ? "$" + d3.format(".2s")(d) : d3.format(".3s")(d));

    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(xAxis)
        .attr("class", "text-[9px] opacity-60")
        .call(g => g.selectAll("path").attr("stroke", "var(--color-border-strong)"))
        .call(g => g.selectAll("line").remove());

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

            // Highlight cumulative dot
            if (showCumulative) {
                const dotClass = d.isBuy ? ".buy-cum-dot" : ".sell-cum-dot";
                lineGroup.selectAll(dotClass)
                    .filter(bd => bd.price === d.price)
                    .attr("r", 6);
            }

            // Show tooltip
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
                    <div class="text-gray-400 text-[10px] mb-1">Cumulative:</div>
                    <div>Vol: ${Utils.fmtNum(d.cumulativeQty, 4)}</div>
                    <div>Val: ${Utils.fmtCurr(d.cumulativeVal)}</div>
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
                const dotClass = d.isBuy ? ".buy-cum-dot" : ".sell-cum-dot";
                lineGroup.selectAll(dotClass)
                    .filter(bd => bd.price === d.price)
                    .attr("r", 4);
            }
            tooltip.classed("hidden", true).style("opacity", 0);
            svg.selectAll(".cursor-line").remove();
        });
}

// Expose to global scope
window.drawDepthChart = drawDepthChart;

