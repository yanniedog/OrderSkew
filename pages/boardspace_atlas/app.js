(function () {
  "use strict";

  const data = window.BoardSpaceAtlasData;
  const renderers = window.BoardSpaceAtlasRenderers;

  if (!Array.isArray(data) || !renderers) {
    throw new Error("BoardSpace Atlas failed to initialize: missing data or renderers.");
  }

  const GAME_BY_ID = new Map(data.map(function (game) { return [game.gameId, game]; }));
  const CATEGORY_COLORS = d3.scaleOrdinal()
    .domain(["opening", "pressure", "threat", "midgame", "defense", "endgame"])
    .range(["#68b0ff", "#5ec0a6", "#f1b749", "#ef9d62", "#6bc1d3", "#ef7b63"]);

  const state = {
    currentGameId: data[0].gameId,
    selectedPositionId: data[0].positions[0].id,
    symmetryEnabled: false
  };

  const els = {
    gameSelect: document.getElementById("game-select"),
    symmetryToggle: document.getElementById("symmetry-toggle"),
    miniGrid: document.getElementById("mini-grid"),
    neighborList: document.getElementById("neighbor-list"),
    selectionChip: document.getElementById("selection-chip"),
    scatter: document.getElementById("scatter"),
    bars: document.getElementById("bars"),
    vectorBox: document.getElementById("vector-box"),
    heatmap: document.getElementById("heatmap"),
    legend: document.getElementById("category-legend"),
    tooltip: document.getElementById("tooltip")
  };

  function currentGame() {
    return GAME_BY_ID.get(state.currentGameId);
  }

  function selectedPosition() {
    const game = currentGame();
    return game.positions.find(function (p) { return p.id === state.selectedPositionId; }) || game.positions[0];
  }

  function euclideanDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
      const d = a[i] - b[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  function topNeighbors(pos, positions, k) {
    return positions
      .filter(function (p) { return p.id !== pos.id; })
      .map(function (p) {
        return {
          id: p.id,
          label: p.label,
          category: p.category,
          distance: euclideanDistance(pos.embedding, p.embedding)
        };
      })
      .sort(function (a, b) { return a.distance - b.distance; })
      .slice(0, k);
  }

  function similarityMatrix(positions) {
    const n = positions.length;
    const out = Array.from({ length: n }, function () {
      return Array.from({ length: n }, function () { return 0; });
    });
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const dist = euclideanDistance(positions[i].embedding, positions[j].embedding);
        out[i][j] = 1 / (1 + dist);
      }
    }
    return out;
  }

  function populateGameSelector() {
    els.gameSelect.innerHTML = "";
    data.forEach(function (game) {
      const option = document.createElement("option");
      option.value = game.gameId;
      option.textContent = game.gameName;
      els.gameSelect.appendChild(option);
    });
    els.gameSelect.value = state.currentGameId;
  }

  function setTooltip(text, x, y) {
    els.tooltip.textContent = text;
    els.tooltip.style.left = x + 12 + "px";
    els.tooltip.style.top = y - 10 + "px";
    els.tooltip.style.opacity = "1";
  }

  function hideTooltip() {
    els.tooltip.style.opacity = "0";
  }

  function renderMiniGrid() {
    const game = currentGame();
    const selected = selectedPosition();
    els.miniGrid.innerHTML = "";
    const selectedGroup = selected.symmetryGroup;

    game.positions.forEach(function (pos) {
      const card = document.createElement("article");
      card.className = "mini-card";
      if (pos.id === selected.id) card.classList.add("selected");
      if (
        state.symmetryEnabled &&
        selectedGroup !== null &&
        pos.symmetryGroup !== null &&
        pos.symmetryGroup === selectedGroup &&
        pos.id !== selected.id
      ) {
        card.classList.add("sym");
      }

      const canvas = document.createElement("canvas");
      canvas.width = 72;
      canvas.height = 72;
      renderers.drawMiniBoard(canvas, game, pos.board);
      card.appendChild(canvas);

      const title = document.createElement("span");
      title.className = "mini-title";
      title.textContent = pos.label;
      card.appendChild(title);

      const cat = document.createElement("span");
      cat.className = "mini-cat";
      cat.textContent = pos.category;
      card.appendChild(cat);

      card.addEventListener("click", function () {
        state.selectedPositionId = pos.id;
        renderAll();
      });

      els.miniGrid.appendChild(card);
    });
  }

  function renderNeighbors() {
    const game = currentGame();
    const selected = selectedPosition();
    const nearest = topNeighbors(selected, game.positions, 3);
    els.neighborList.innerHTML = "";
    nearest.forEach(function (n) {
      const row = document.createElement("div");
      row.className = "neighbor-row";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = n.label + " (" + n.category + ")";
      btn.addEventListener("click", function () {
        state.selectedPositionId = n.id;
        renderAll();
      });

      const dist = document.createElement("span");
      dist.textContent = n.distance.toFixed(3);

      row.appendChild(btn);
      row.appendChild(dist);
      els.neighborList.appendChild(row);
    });
  }

  function renderLegend(game) {
    const categories = Array.from(new Set(game.positions.map(function (p) { return p.category; })));
    els.legend.innerHTML = "";
    categories.forEach(function (cat) {
      const chip = document.createElement("span");
      chip.className = "legend-chip";
      const dot = document.createElement("span");
      dot.className = "legend-dot";
      dot.style.background = CATEGORY_COLORS(cat);
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(cat));
      els.legend.appendChild(chip);
    });
  }

  function renderScatter() {
    const game = currentGame();
    const selected = selectedPosition();
    const width = Math.max(360, els.scatter.clientWidth || 360);
    const height = 360;
    const margin = { top: 24, right: 18, bottom: 34, left: 38 };

    d3.select(els.scatter).selectAll("*").remove();
    const svg = d3.select(els.scatter).append("svg").attr("width", width).attr("height", height);

    const xExtent = d3.extent(game.positions, function (d) { return d.pca2d[0]; });
    const yExtent = d3.extent(game.positions, function (d) { return d.pca2d[1]; });

    const x = d3.scaleLinear().domain([xExtent[0] - 2, xExtent[1] + 2]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([yExtent[0] - 2, yExtent[1] + 2]).range([height - margin.bottom, margin.top]);

    const xAxis = d3.axisBottom(x).ticks(6).tickSizeOuter(0);
    const yAxis = d3.axisLeft(y).ticks(6).tickSizeOuter(0);

    svg.append("g")
      .attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(xAxis)
      .call(function (g) { g.selectAll("text").attr("fill", "#cde0ec").attr("font-size", 10); })
      .call(function (g) { g.selectAll("path,line").attr("stroke", "rgba(184,206,219,0.32)"); });

    svg.append("g")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(yAxis)
      .call(function (g) { g.selectAll("text").attr("fill", "#cde0ec").attr("font-size", 10); })
      .call(function (g) { g.selectAll("path,line").attr("stroke", "rgba(184,206,219,0.32)"); });

    const selectedGroup = selected.symmetryGroup;

    svg.append("g")
      .selectAll("circle")
      .data(game.positions)
      .enter()
      .append("circle")
      .attr("cx", function (d) { return x(d.pca2d[0]); })
      .attr("cy", function (d) { return y(d.pca2d[1]); })
      .attr("r", function (d) { return d.id === selected.id ? 7 : 5.3; })
      .attr("fill", function (d) { return CATEGORY_COLORS(d.category); })
      .attr("opacity", function (d) {
        if (d.id === selected.id) return 1;
        if (state.symmetryEnabled && selectedGroup !== null && d.symmetryGroup !== null && d.symmetryGroup === selectedGroup) return 0.95;
        return 0.76;
      })
      .attr("stroke", function (d) {
        if (d.id === selected.id) return "#ffe6bc";
        if (state.symmetryEnabled && selectedGroup !== null && d.symmetryGroup !== null && d.symmetryGroup === selectedGroup) return "#bff0cf";
        return "rgba(230,243,250,0.6)";
      })
      .attr("stroke-width", function (d) { return d.id === selected.id ? 2.2 : 1.1; })
      .style("cursor", "pointer")
      .on("click", function (_, d) {
        state.selectedPositionId = d.id;
        renderAll();
      })
      .on("mousemove", function (event, d) {
        setTooltip(d.label + " | " + d.category, event.pageX, event.pageY);
      })
      .on("mouseleave", hideTooltip);

    renderLegend(game);
  }

  function renderBars() {
    const game = currentGame();
    const selected = selectedPosition();
    const width = Math.max(260, els.bars.clientWidth || 260);
    const height = 230;
    const margin = { top: 14, right: 8, bottom: 48, left: 8 };
    d3.select(els.bars).selectAll("*").remove();

    const svg = d3.select(els.bars).append("svg").attr("width", width).attr("height", height);

    const x = d3.scaleBand().domain(game.features).range([margin.left, width - margin.right]).padding(0.22);
    const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);

    svg.append("g")
      .attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).tickFormat(function (_, i) { return "f" + (i + 1); }))
      .call(function (g) { g.selectAll("text").attr("fill", "#cadfeb").attr("font-size", 10); })
      .call(function (g) { g.selectAll("path,line").attr("stroke", "rgba(184,206,219,0.28)"); });

    svg.append("g")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(6))
      .call(function (g) { g.selectAll("text").attr("fill", "#acc4d4").attr("font-size", 10); })
      .call(function (g) { g.select("path").remove(); })
      .call(function (g) { g.selectAll("line").remove(); });

    const bars = selected.embedding.map(function (value, i) { return { value: value, feature: game.features[i] }; });

    svg.selectAll("rect")
      .data(bars)
      .enter()
      .append("rect")
      .attr("x", function (d) { return x(d.feature); })
      .attr("width", x.bandwidth())
      .attr("y", function (d) { return y(d.value); })
      .attr("height", function (d) { return y(0) - y(d.value); })
      .attr("fill", "#6cb4ff")
      .attr("rx", 5);

    svg.selectAll("text.value")
      .data(bars)
      .enter()
      .append("text")
      .attr("class", "value")
      .attr("x", function (d) { return x(d.feature) + x.bandwidth() / 2; })
      .attr("y", function (d) { return y(d.value) - 6; })
      .attr("text-anchor", "middle")
      .attr("fill", "#dbecf7")
      .attr("font-size", 10)
      .text(function (d) { return d.value.toFixed(2); });
  }

  function renderVectorBox() {
    const game = currentGame();
    const selected = selectedPosition();
    const rows = selected.embedding.map(function (v, i) {
      return game.features[i] + ": " + v.toFixed(3);
    });
    const text = "Position: " + selected.label + "\n"
      + "Category: " + selected.category + "\n"
      + "Vector:\n"
      + rows.join("\n")
      + (selected.notes ? "\n\nNotes: " + selected.notes : "");
    els.vectorBox.textContent = text;
  }

  function renderHeatmap() {
    const game = currentGame();
    const selected = selectedPosition();
    const positions = game.positions;
    const selectedIndex = positions.findIndex(function (p) { return p.id === selected.id; });
    const sim = similarityMatrix(positions);
    const n = positions.length;
    const width = Math.max(440, els.heatmap.clientWidth || 440);
    const height = 260;
    const margin = { top: 30, right: 12, bottom: 30, left: 34 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const cellSize = Math.min(innerW / n, innerH / n);
    const gridW = cellSize * n;
    const gridH = cellSize * n;

    d3.select(els.heatmap).selectAll("*").remove();
    const svg = d3.select(els.heatmap).append("svg").attr("width", width).attr("height", height);
    const g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    const color = d3.scaleLinear().domain([0.45, 0.75, 1.0]).range(["#203142", "#3f826f", "#b9f0cc"]).clamp(true);

    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        g.append("rect")
          .attr("x", c * cellSize)
          .attr("y", r * cellSize)
          .attr("width", cellSize)
          .attr("height", cellSize)
          .attr("fill", color(sim[r][c]))
          .attr("stroke", "rgba(198,221,236,0.2)")
          .attr("stroke-width", 0.5);
      }
    }

    g.append("rect")
      .attr("x", selectedIndex * cellSize)
      .attr("y", 0)
      .attr("width", cellSize)
      .attr("height", gridH)
      .attr("fill", "none")
      .attr("stroke", "rgba(241,183,73,0.9)")
      .attr("stroke-width", 2);

    g.append("rect")
      .attr("x", 0)
      .attr("y", selectedIndex * cellSize)
      .attr("width", gridW)
      .attr("height", cellSize)
      .attr("fill", "none")
      .attr("stroke", "rgba(241,183,73,0.9)")
      .attr("stroke-width", 2);

    const ticks = positions.map(function (_, i) { return i + 1; });
    const tickScale = d3.scaleBand().domain(ticks).range([0, gridW]);

    g.append("g")
      .attr("transform", "translate(0," + gridH + ")")
      .call(d3.axisBottom(tickScale).tickValues(ticks).tickFormat(function (d) { return d; }))
      .call(function (axis) { axis.selectAll("text").attr("fill", "#cde0ec").attr("font-size", 9); })
      .call(function (axis) { axis.selectAll("path,line").attr("stroke", "rgba(184,206,219,0.2)"); });

    g.append("g")
      .call(d3.axisLeft(tickScale).tickValues(ticks).tickFormat(function (d) { return d; }))
      .call(function (axis) { axis.selectAll("text").attr("fill", "#cde0ec").attr("font-size", 9); })
      .call(function (axis) { axis.selectAll("path,line").attr("stroke", "rgba(184,206,219,0.2)"); });
  }

  function renderSelectionChip() {
    const game = currentGame();
    const selected = selectedPosition();
    els.selectionChip.textContent = game.gameName + " | " + selected.label;
  }

  function renderAll() {
    renderSelectionChip();
    renderMiniGrid();
    renderNeighbors();
    renderScatter();
    renderBars();
    renderVectorBox();
    renderHeatmap();
  }

  function bindEvents() {
    els.gameSelect.addEventListener("change", function (event) {
      state.currentGameId = event.target.value;
      const game = currentGame();
      state.selectedPositionId = game.positions[0].id;
      renderAll();
    });

    els.symmetryToggle.addEventListener("click", function () {
      state.symmetryEnabled = !state.symmetryEnabled;
      els.symmetryToggle.dataset.on = state.symmetryEnabled ? "true" : "false";
      els.symmetryToggle.textContent = state.symmetryEnabled ? "On" : "Off";
      renderAll();
    });

    let resizeTimer = null;
    window.addEventListener("resize", function () {
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(function () {
        renderScatter();
        renderBars();
        renderHeatmap();
      }, 120);
    });
  }

  function init() {
    populateGameSelector();
    bindEvents();
    renderAll();
  }

  init();
})();
