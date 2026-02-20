(function () {
  "use strict";

  function renderLatentBars(container, latent) {
    const values = Array.isArray(latent) ? latent : [];
    const width = Math.max(360, values.length * 12 + 50);
    const height = 230;
    const margin = { top: 10, right: 12, bottom: 30, left: 30 };

    d3.select(container).selectAll("*").remove();
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);

    const x = d3.scaleBand().domain(values.map(function (_, i) { return i; })).range([margin.left, width - margin.right]).padding(0.15);
    const y = d3.scaleLinear().domain([-1, 1]).range([height - margin.bottom, margin.top]);

    svg.append("line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", y(0))
      .attr("y2", y(0))
      .attr("stroke", "rgba(201, 222, 236, 0.35)");

    svg.append("g")
      .attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).tickValues(values.map(function (_, i) { return i; }).filter(function (i) { return i % 8 === 0; })).tickFormat(function (i) { return "z" + i; }))
      .call(function (g) {
        g.selectAll("text").attr("fill", "#b9cedb").attr("font-size", 9);
        g.selectAll("path,line").attr("stroke", "rgba(183,205,220,0.2)");
      });

    svg.append("g")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(5))
      .call(function (g) {
        g.selectAll("text").attr("fill", "#b9cedb").attr("font-size", 9);
        g.selectAll("path,line").attr("stroke", "rgba(183,205,220,0.2)");
      });

    svg.selectAll("rect")
      .data(values)
      .enter()
      .append("rect")
      .attr("x", function (_, i) { return x(i); })
      .attr("width", x.bandwidth())
      .attr("y", function (d) { return y(Math.max(0, d)); })
      .attr("height", function (d) { return Math.abs(y(d) - y(0)); })
      .attr("rx", 2)
      .attr("fill", function (d) { return d >= 0 ? "#6dc4ff" : "#ef9f63"; });
  }

  function dot(a, b) {
    let out = 0;
    for (let i = 0; i < a.length; i += 1) out += a[i] * b[i];
    return out;
  }

  function norm(v) {
    return Math.sqrt(dot(v, v));
  }

  function matVecMul(mat, vec) {
    const out = new Array(mat.length).fill(0);
    for (let r = 0; r < mat.length; r += 1) {
      let acc = 0;
      for (let c = 0; c < vec.length; c += 1) acc += mat[r][c] * vec[c];
      out[r] = acc;
    }
    return out;
  }

  function outer(v) {
    const out = [];
    for (let r = 0; r < v.length; r += 1) {
      const row = [];
      for (let c = 0; c < v.length; c += 1) row.push(v[r] * v[c]);
      out.push(row);
    }
    return out;
  }

  function matSub(a, b, scaleB) {
    const out = [];
    for (let r = 0; r < a.length; r += 1) {
      const row = [];
      for (let c = 0; c < a[r].length; c += 1) row.push(a[r][c] - scaleB * b[r][c]);
      out.push(row);
    }
    return out;
  }

  function powerIteration(matrix, steps) {
    const n = matrix.length;
    let v = new Array(n).fill(0).map(function (_, i) { return i % 2 === 0 ? 1 : -1; });
    let vNorm = norm(v) || 1;
    v = v.map(function (x) { return x / vNorm; });
    for (let i = 0; i < steps; i += 1) {
      let next = matVecMul(matrix, v);
      vNorm = norm(next);
      if (vNorm < 1e-10) break;
      v = next.map(function (x) { return x / vNorm; });
    }
    const mv = matVecMul(matrix, v);
    const eigenvalue = dot(v, mv);
    return { vector: v, value: eigenvalue };
  }

  function computePca2D(vectors) {
    if (!Array.isArray(vectors) || vectors.length < 2) return [];
    const n = vectors.length;
    const d = vectors[0].length;
    if (d === 0) return [];

    const mean = new Array(d).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < d; j += 1) mean[j] += vectors[i][j];
    }
    for (let j = 0; j < d; j += 1) mean[j] /= n;

    const centered = vectors.map(function (v) {
      return v.map(function (x, i) { return x - mean[i]; });
    });

    const cov = Array.from({ length: d }, function () {
      return new Array(d).fill(0);
    });
    for (let i = 0; i < n; i += 1) {
      const row = centered[i];
      for (let r = 0; r < d; r += 1) {
        for (let c = r; c < d; c += 1) {
          cov[r][c] += row[r] * row[c];
        }
      }
    }
    const div = Math.max(1, n - 1);
    for (let r = 0; r < d; r += 1) {
      for (let c = r; c < d; c += 1) {
        cov[r][c] /= div;
        cov[c][r] = cov[r][c];
      }
    }

    const p1 = powerIteration(cov, 40);
    const deflated = matSub(cov, outer(p1.vector), p1.value);
    const p2 = powerIteration(deflated, 40);

    return centered.map(function (v) {
      return [dot(v, p1.vector), dot(v, p2.vector)];
    });
  }

  function renderPcaScatter(container, points, currentIndex) {
    const width = Math.max(340, container.clientWidth || 340);
    const height = 240;
    const margin = { top: 18, right: 12, bottom: 24, left: 28 };

    d3.select(container).selectAll("*").remove();
    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
    if (!Array.isArray(points) || points.length === 0) return;

    const xExtent = d3.extent(points, function (p) { return p[0]; });
    const yExtent = d3.extent(points, function (p) { return p[1]; });
    const x = d3.scaleLinear().domain([xExtent[0] - 0.1, xExtent[1] + 0.1]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([yExtent[0] - 0.1, yExtent[1] + 0.1]).range([height - margin.bottom, margin.top]);

    svg.append("g")
      .attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).ticks(4))
      .call(function (g) {
        g.selectAll("text").attr("fill", "#bdd2df").attr("font-size", 9);
        g.selectAll("path,line").attr("stroke", "rgba(180,204,220,0.24)");
      });

    svg.append("g")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(4))
      .call(function (g) {
        g.selectAll("text").attr("fill", "#bdd2df").attr("font-size", 9);
        g.selectAll("path,line").attr("stroke", "rgba(180,204,220,0.24)");
      });

    svg.append("g")
      .selectAll("circle")
      .data(points)
      .enter()
      .append("circle")
      .attr("cx", function (d) { return x(d[0]); })
      .attr("cy", function (d) { return y(d[1]); })
      .attr("r", function (_, i) { return i === currentIndex ? 5.5 : 3.2; })
      .attr("fill", function (_, i) { return i === currentIndex ? "#f7bb6a" : "#72c0ff"; })
      .attr("opacity", function (_, i) { return i === currentIndex ? 1 : 0.6; })
      .attr("stroke", function (_, i) { return i === currentIndex ? "#ffe4be" : "none"; });
  }

  window.BoardSpaceAtlasRenderers = {
    renderLatentBars: renderLatentBars,
    computePca2D: computePca2D,
    renderPcaScatter: renderPcaScatter
  };
})();

