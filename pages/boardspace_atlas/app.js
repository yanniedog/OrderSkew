(function () {
  "use strict";

  const renderers = window.BoardSpaceAtlasRenderers;
  const STORAGE_KEY = "boardspace_atlas_live_config_v1";
  const DEFAULT_API_BASE = "http://localhost:8008";

  const GAME_META = {
    tictactoe: { rows: 3, cols: 3, actionSize: 9, defaultSims: 200, label: "Tic-Tac-Toe" },
    connect4: { rows: 6, cols: 7, actionSize: 7, defaultSims: 800, label: "Connect 4" },
    othello: { rows: 8, cols: 8, actionSize: 65, defaultSims: 800, label: "Othello" }
  };

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  const persisted = loadConfig();
  const state = {
    apiBase: persisted.apiBase || DEFAULT_API_BASE,
    gameId: persisted.gameId || "tictactoe",
    humanPlayer: persisted.humanPlayer || 1,
    sims: persisted.sims || GAME_META[persisted.gameId || "tictactoe"].defaultSims,
    analysisMode: persisted.analysisMode || "live",
    sessionId: null,
    sessionState: null,
    analysis: null,
    passProb: 0,
    status: "idle",
    aiJobId: null,
    pollingTimer: null,
    latentHistory: []
  };

  const els = {
    backendUrl: document.getElementById("backend-url"),
    gameSelect: document.getElementById("game-select"),
    aiSims: document.getElementById("ai-sims"),
    humanSide: document.getElementById("human-side"),
    analysisLive: document.getElementById("analysis-live"),
    startBtn: document.getElementById("start-btn"),
    passBtn: document.getElementById("pass-btn"),
    statusChip: document.getElementById("status-chip"),
    sessionChip: document.getElementById("session-chip"),
    turnLabel: document.getElementById("turn-label"),
    playBoard: document.getElementById("play-board"),
    playMeta: document.getElementById("play-meta"),
    policyBoard: document.getElementById("policy-board"),
    valueText: document.getElementById("value-text"),
    valueFill: document.getElementById("value-fill"),
    mctsProgress: document.getElementById("mcts-progress"),
    latentBars: document.getElementById("latent-bars"),
    latentScatter: document.getElementById("latent-scatter"),
    topActions: document.getElementById("top-actions"),
    archiveRoot: document.getElementById("atlas-archive"),
    archiveGame: document.getElementById("archive-game"),
    archiveList: document.getElementById("archive-list"),
    archiveDetail: document.getElementById("archive-detail")
  };

  const archiveState = {
    data: Array.isArray(window.BoardSpaceAtlasData) ? window.BoardSpaceAtlasData : [],
    gameId: null,
    positionId: null,
    initialized: false
  };

  function persist() {
    saveConfig({
      apiBase: state.apiBase,
      gameId: state.gameId,
      humanPlayer: state.humanPlayer,
      sims: state.sims,
      analysisMode: state.analysisMode
    });
  }

  function setStatus(text) {
    state.status = text;
    els.statusChip.textContent = text;
  }

  function showSession() {
    els.sessionChip.textContent = state.sessionId ? state.sessionId : "no session";
  }

  async function api(path, options) {
    const base = String(state.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
    const response = await fetch(base + path, {
      headers: { "Content-Type": "application/json" },
      ...(options || {})
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload && (payload.detail || payload.message || JSON.stringify(payload));
      throw new Error("HTTP " + response.status + (detail ? (": " + detail) : ""));
    }
    return payload;
  }

  function isHumanTurn() {
    return Boolean(
      state.sessionState &&
      state.sessionState.result === "ongoing" &&
      state.sessionState.to_play === state.humanPlayer
    );
  }

  function isAiTurn() {
    return Boolean(
      state.sessionState &&
      state.sessionState.result === "ongoing" &&
      state.sessionState.to_play === -state.humanPlayer
    );
  }

  function stopPolling() {
    if (state.pollingTimer) {
      window.clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  function pushLatent(latent) {
    if (!Array.isArray(latent) || latent.length === 0) return;
    const prev = state.latentHistory[state.latentHistory.length - 1];
    if (prev && prev.length === latent.length) {
      let same = true;
      for (let i = 0; i < latent.length; i += 1) {
        if (Math.abs(prev[i] - latent[i]) > 1e-7) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    state.latentHistory.push(latent.slice());
    if (state.latentHistory.length > 200) state.latentHistory.shift();
  }

  function applyAnalysis(analysis, progress) {
    if (!analysis) return;
    state.analysis = analysis;
    state.passProb = state.gameId === "othello" && Array.isArray(analysis.policy) ? (analysis.policy[64] || 0) : 0;
    pushLatent(analysis.latent || []);

    const v = Number(analysis.value || 0);
    els.valueText.textContent = v.toFixed(3);
    els.valueFill.style.width = Math.max(0, Math.min(100, v * 100)) + "%";

    const prog = progress ? ("Simulations: " + progress.done + "/" + progress.total) : "Simulations: -";
    const passLine = state.gameId === "othello" ? ("\nPass prob: " + (state.passProb * 100).toFixed(1) + "%") : "";
    els.mctsProgress.textContent = prog + passLine;

    renderers.renderLatentBars(els.latentBars, analysis.latent || []);
    const points = renderers.computePca2D(state.latentHistory);
    renderers.renderPcaScatter(els.latentScatter, points, points.length - 1);
    renderTopActions();
  }

  function actionLabel(action) {
    if (state.gameId === "tictactoe") {
      const r = Math.floor(action / 3);
      const c = action % 3;
      return "r" + (r + 1) + "c" + (c + 1);
    }
    if (state.gameId === "connect4") {
      return "col " + (action + 1);
    }
    if (state.gameId === "othello") {
      if (action === 64) return "pass";
      const r = Math.floor(action / 8);
      const c = action % 8;
      return "r" + (r + 1) + "c" + (c + 1);
    }
    return String(action);
  }

  function renderTopActions() {
    els.topActions.innerHTML = "";
    if (!state.analysis || !state.analysis.mcts) {
      els.topActions.textContent = "No MCTS details yet.";
      return;
    }
    const mcts = state.analysis.mcts;
    const visits = Array.isArray(mcts.visit_counts) ? mcts.visit_counts : [];
    const q = Array.isArray(mcts.q_values) ? mcts.q_values : [];
    const total = visits.reduce(function (acc, n) { return acc + Number(n || 0); }, 0) || 1;
    const rows = visits.map(function (v, i) {
      return { action: i, visits: Number(v || 0), prob: Number(v || 0) / total, q: Number(q[i] || 0) };
    }).filter(function (r) { return r.visits > 0; })
      .sort(function (a, b) { return b.visits - a.visits; })
      .slice(0, 5);
    if (!rows.length) {
      els.topActions.textContent = "No expanded actions yet.";
      return;
    }
    rows.forEach(function (row) {
      const div = document.createElement("div");
      div.className = "action-row";
      div.innerHTML = "<span>" + actionLabel(row.action) + "</span>"
        + "<span>" + (row.prob * 100).toFixed(1) + "%</span>"
        + "<span>Q " + row.q.toFixed(3) + "</span>";
      els.topActions.appendChild(div);
    });
  }

  function legalSet() {
    return new Set((state.sessionState && state.sessionState.legal_actions) || []);
  }

  function landingRow(board, col) {
    for (let r = board.length - 1; r >= 0; r -= 1) {
      if (board[r][col] === 0) return r;
    }
    return -1;
  }

  function buildPolicyHeat() {
    if (!state.sessionState) return [];
    const board = state.sessionState.board;
    const rows = board.length;
    const cols = board[0].length;
    const out = Array.from({ length: rows }, function () {
      return Array.from({ length: cols }, function () { return 0; });
    });
    if (!state.analysis || !Array.isArray(state.analysis.policy)) return out;
    const p = state.analysis.policy;
    if (state.gameId === "tictactoe") {
      for (let a = 0; a < 9; a += 1) {
        const r = Math.floor(a / 3);
        const c = a % 3;
        out[r][c] = p[a] || 0;
      }
    } else if (state.gameId === "connect4") {
      for (let c = 0; c < 7; c += 1) {
        const r = landingRow(board, c);
        if (r >= 0) out[r][c] = p[c] || 0;
      }
    } else if (state.gameId === "othello") {
      for (let a = 0; a < 64; a += 1) {
        const r = Math.floor(a / 8);
        const c = a % 8;
        out[r][c] = p[a] || 0;
      }
    }
    return out;
  }

  function pieceCell(gameId, value) {
    if (value === 0) return "";
    if (gameId === "tictactoe") return value === 1 ? "X" : "O";
    return "<span class=\"disc " + (value === 1 ? "p1" : "p2") + "\"></span>";
  }

  function renderGrid(container, interactive) {
    container.innerHTML = "";
    if (!state.sessionState) return;
    const board = state.sessionState.board;
    const rows = board.length;
    const cols = board[0].length;
    const legal = legalSet();
    const policy = buildPolicyHeat();

    const grid = document.createElement("div");
    grid.className = "grid";
    grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(28px, 1fr))";

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        const value = board[r][c];
        const prob = Number((policy[r] && policy[r][c]) || 0);
        const action = state.gameId === "connect4" ? c : (state.gameId === "othello" ? (r * 8 + c) : (r * 3 + c));
        const legalAction = state.gameId === "connect4" ? legal.has(c) : legal.has(action);
        const canClick = Boolean(interactive && isHumanTurn() && legalAction && !state.aiJobId);

        cell.className = "cell policy";
        if (state.gameId === "tictactoe") cell.classList.add("ttt");
        if (value === 1) cell.classList.add("p1");
        if (value === -1) cell.classList.add("p2");
        if (legalAction) cell.classList.add("legal");
        if (canClick) cell.classList.add("clickable");
        cell.style.setProperty("--policy", Math.min(0.86, prob * 2.2).toFixed(3));
        cell.innerHTML = pieceCell(state.gameId, value);
        if (prob > 0.001) {
          const p = document.createElement("span");
          p.className = "prob";
          p.textContent = (prob * 100).toFixed(0) + "%";
          cell.appendChild(p);
        }
        cell.addEventListener("click", function () {
          if (!canClick) return;
          if (state.gameId === "connect4") playHumanMove(c);
          else playHumanMove(action);
        });
        grid.appendChild(cell);
      }
    }
    container.appendChild(grid);
  }

  function updatePassButton() {
    const legal = legalSet();
    const show = state.gameId === "othello" && isHumanTurn() && legal.has(64);
    els.passBtn.style.display = show ? "block" : "none";
    els.passBtn.textContent = show ? ("Pass (p=" + (state.passProb * 100).toFixed(1) + "%)") : "Pass (Othello)";
  }

  function renderMeta() {
    if (!state.sessionState) {
      els.playMeta.textContent = "No game state.";
      els.turnLabel.textContent = "Start a session to begin.";
      return;
    }
    const turn = state.sessionState.to_play === 1 ? "Player +1" : "Player -1";
    const side = state.humanPlayer === 1 ? "Human: +1" : "Human: -1";
    const job = state.aiJobId ? "AI job: " + state.aiJobId : "AI job: none";
    els.turnLabel.textContent = "Turn: " + turn + " | Result: " + state.sessionState.result;
    els.playMeta.textContent = [
      "Session: " + state.sessionId,
      side,
      "Ply: " + state.sessionState.ply,
      "Legal actions: " + state.sessionState.legal_actions.join(", "),
      job
    ].join("\n");
  }

  function renderAll() {
    renderGrid(els.playBoard, true);
    renderGrid(els.policyBoard, false);
    renderMeta();
    updatePassButton();
  }

  function archiveBoardText(gameId, board) {
    if (!board) return "";
    if (gameId === "tictactoe") {
      const rows = [];
      for (let i = 0; i < board.length; i += 3) {
        rows.push(
          board.slice(i, i + 3).map(function (c) {
            return c === "X" || c === "O" ? c : ".";
          }).join(" ")
        );
      }
      return rows.join("\n");
    }
    if (Array.isArray(board) && Array.isArray(board[0])) {
      return board.map(function (row) {
        return row.map(function (v) {
          if (typeof v === "string") return v || ".";
          if (v === 0) return ".";
          if (v === 1) return "1";
          if (v === 2) return "2";
          if (v === -1) return "-";
          return String(v);
        }).join(" ");
      }).join("\n");
    }
    return JSON.stringify(board, null, 2);
  }

  function renderArchiveDetail() {
    const game = archiveState.data.find(function (g) { return g.gameId === archiveState.gameId; });
    if (!game) {
      els.archiveDetail.textContent = "No archive data found.";
      return;
    }
    const pos = game.positions.find(function (p) { return p.id === archiveState.positionId; }) || game.positions[0];
    if (!pos) {
      els.archiveDetail.textContent = "No archived positions for this game.";
      return;
    }
    const emb = Array.isArray(pos.embedding) ? pos.embedding.map(function (v) { return Number(v).toFixed(3); }).join(", ") : "-";
    els.archiveDetail.textContent = [
      "Game: " + game.gameName,
      "Label: " + pos.label,
      "Category: " + pos.category,
      "Symmetry Group: " + (pos.symmetryGroup == null ? "-" : String(pos.symmetryGroup)),
      "",
      "Board:",
      archiveBoardText(game.gameId, pos.board),
      "",
      "Embedding:",
      emb,
      pos.notes ? ("\nNotes: " + pos.notes) : ""
    ].join("\n");
  }

  function renderArchiveList() {
    const game = archiveState.data.find(function (g) { return g.gameId === archiveState.gameId; });
    els.archiveList.innerHTML = "";
    if (!game || !Array.isArray(game.positions)) {
      els.archiveList.textContent = "No archived positions.";
      return;
    }
    game.positions.forEach(function (pos) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "archive-btn";
      if (pos.id === archiveState.positionId) btn.classList.add("active");
      btn.textContent = pos.label;
      btn.addEventListener("click", function () {
        archiveState.positionId = pos.id;
        renderArchiveList();
        renderArchiveDetail();
      });
      els.archiveList.appendChild(btn);
    });
    renderArchiveDetail();
  }

  function initArchive() {
    if (archiveState.initialized) return;
    archiveState.initialized = true;
    if (!archiveState.data.length) {
      els.archiveDetail.textContent = "Synthetic archive data not available.";
      return;
    }
    els.archiveGame.innerHTML = "";
    archiveState.data.forEach(function (game) {
      const option = document.createElement("option");
      option.value = game.gameId;
      option.textContent = game.gameName;
      els.archiveGame.appendChild(option);
    });
    archiveState.gameId = archiveState.data[0].gameId;
    archiveState.positionId = archiveState.data[0].positions[0] && archiveState.data[0].positions[0].id;
    els.archiveGame.value = archiveState.gameId;
    els.archiveGame.addEventListener("change", function () {
      archiveState.gameId = els.archiveGame.value;
      const game = archiveState.data.find(function (g) { return g.gameId === archiveState.gameId; });
      archiveState.positionId = game && game.positions[0] ? game.positions[0].id : null;
      renderArchiveList();
    });
    renderArchiveList();
  }

  async function refreshAnalysis() {
    if (!state.sessionId || state.aiJobId) return;
    try {
      const analysis = await api("/api/v1/analyze", {
        method: "POST",
        body: JSON.stringify({ session_id: state.sessionId })
      });
      applyAnalysis(analysis, null);
      renderAll();
    } catch (err) {
      setStatus("analyze error: " + err.message);
    }
  }

  async function playHumanMove(action) {
    if (!state.sessionId || !isHumanTurn() || state.aiJobId) return;
    try {
      setStatus("playing move...");
      const payload = await api("/api/v1/session/" + encodeURIComponent(state.sessionId) + "/human-move", {
        method: "POST",
        body: JSON.stringify({ action: action })
      });
      state.sessionState = payload.state;
      setStatus("human moved");
      renderAll();
      await refreshAnalysis();
      maybeStartAiTurn();
    } catch (err) {
      setStatus("move rejected: " + err.message);
    }
  }

  async function runAiMoveBlocking() {
    try {
      setStatus("AI thinking...");
      const payload = await api("/api/v1/session/" + encodeURIComponent(state.sessionId) + "/ai-move", {
        method: "POST",
        body: JSON.stringify({ sims: state.sims, temperature: 0.0, emit_every: 50 })
      });
      state.sessionState = payload.state_after;
      applyAnalysis(payload.analysis, payload.progress || null);
      setStatus("AI moved");
      renderAll();
    } catch (err) {
      setStatus("AI error: " + err.message);
    }
  }

  async function pollAiJob() {
    if (!state.aiJobId) return;
    try {
      const payload = await api("/api/v1/jobs/" + encodeURIComponent(state.aiJobId), { method: "GET" });
      if (payload.analysis) {
        applyAnalysis(payload.analysis, payload.progress || null);
      }
      if (payload.status === "running") {
        setStatus("AI thinking...");
        renderAll();
        return;
      }
      if (payload.status === "done") {
        state.sessionState = payload.state_after;
        state.aiJobId = null;
        stopPolling();
        setStatus("AI moved");
        renderAll();
        return;
      }
      state.aiJobId = null;
      stopPolling();
      setStatus("AI job error: " + (payload.error || "unknown"));
      renderAll();
    } catch (err) {
      state.aiJobId = null;
      stopPolling();
      setStatus("job poll failed: " + err.message);
      renderAll();
    }
  }

  async function startAiJob() {
    try {
      setStatus("AI thinking...");
      const payload = await api("/api/v1/session/" + encodeURIComponent(state.sessionId) + "/ai-move/start", {
        method: "POST",
        body: JSON.stringify({ sims: state.sims, temperature: 0.0, emit_every: 25 })
      });
      state.aiJobId = payload.job_id;
      stopPolling();
      state.pollingTimer = window.setInterval(pollAiJob, 100);
    } catch (err) {
      setStatus("AI start failed: " + err.message);
    }
  }

  function maybeStartAiTurn() {
    if (!state.sessionState || state.sessionState.result !== "ongoing") return;
    if (!isAiTurn()) return;
    if (state.analysisMode === "live") {
      startAiJob();
    } else {
      runAiMoveBlocking();
    }
  }

  async function startSession() {
    stopPolling();
    state.aiJobId = null;
    state.analysis = null;
    state.sessionState = null;
    state.latentHistory = [];
    state.passProb = 0;
    renderAll();

    try {
      setStatus("starting...");
      const payload = await api("/api/v1/session/start", {
        method: "POST",
        body: JSON.stringify({
          game_id: state.gameId,
          human_player: state.humanPlayer,
          mcts_sims: state.sims,
          analysis_mode: state.analysisMode
        })
      });
      state.sessionId = payload.session_id;
      state.sessionState = payload.state;
      showSession();
      setStatus("session ready");
      renderAll();
      await refreshAnalysis();
      maybeStartAiTurn();
    } catch (err) {
      state.sessionId = null;
      state.sessionState = null;
      showSession();
      setStatus("start failed: " + err.message);
      renderAll();
    }
  }

  function bindEvents() {
    els.backendUrl.addEventListener("change", function () {
      state.apiBase = els.backendUrl.value.trim() || DEFAULT_API_BASE;
      persist();
    });
    els.gameSelect.addEventListener("change", function () {
      state.gameId = els.gameSelect.value;
      const def = GAME_META[state.gameId].defaultSims;
      if (!Number.isFinite(state.sims) || state.sims <= 0) state.sims = def;
      els.aiSims.value = String(state.sims);
      persist();
      renderAll();
    });
    els.aiSims.addEventListener("change", function () {
      const n = Number(els.aiSims.value);
      state.sims = Number.isFinite(n) && n > 0 ? Math.round(n) : GAME_META[state.gameId].defaultSims;
      els.aiSims.value = String(state.sims);
      persist();
    });
    els.humanSide.addEventListener("change", function () {
      state.humanPlayer = Number(els.humanSide.value) >= 0 ? 1 : -1;
      persist();
    });
    els.analysisLive.addEventListener("change", function () {
      state.analysisMode = els.analysisLive.value === "off" ? "off" : "live";
      persist();
    });
    els.startBtn.addEventListener("click", startSession);
    els.passBtn.addEventListener("click", function () {
      playHumanMove(64);
    });
    if (els.archiveRoot) {
      els.archiveRoot.addEventListener("toggle", function () {
        if (els.archiveRoot.open) initArchive();
      });
    }
  }

  function init() {
    els.backendUrl.value = state.apiBase;
    els.gameSelect.value = state.gameId;
    els.aiSims.value = String(state.sims);
    els.humanSide.value = String(state.humanPlayer);
    els.analysisLive.value = state.analysisMode;
    showSession();
    bindEvents();
    renderAll();
    if (els.archiveRoot && els.archiveRoot.open) initArchive();
  }

  init();
})();
