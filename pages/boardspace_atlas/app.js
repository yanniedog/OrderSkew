(function () {
  "use strict";

  const renderers = window.BoardSpaceAtlasRenderers;
  const STORAGE_KEY = "boardspace_atlas_live_config_v1";
  const LOCAL_API_BASE = "http://localhost:8008";
  const PRODUCTION_API_BASE = "https://api.orderskew.com";
  const SAME_ORIGIN_API_BASE = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
  function getDefaultApiBase() {
    const host = typeof window !== "undefined" && window.location && window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return LOCAL_API_BASE;
    return PRODUCTION_API_BASE;
  }
  const DEFAULT_API_BASE = getDefaultApiBase();

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

  function safeSerialize(value) {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function summarizeArrayTop(arr, n) {
    if (!Array.isArray(arr)) return [];
    return arr
      .map(function (v, i) { return { i: i, v: Number(v || 0) }; })
      .sort(function (a, b) { return b.v - a.v; })
      .slice(0, n);
  }

  function logDebug(level, event, details) {
    if (window.OrderSkewDebugLogger && typeof window.OrderSkewDebugLogger.log === "function") {
      window.OrderSkewDebugLogger.log(level, "boardspace_atlas." + event, {
        details: details || {},
        context: {
          game_id: state.gameId,
          session_id: state.sessionId,
          status: state.status,
          ai_job_id: state.aiJobId
        }
      });
    }
  }

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
    logDebug("DEBUG", "persist.config", {
      api_base: state.apiBase,
      game_id: state.gameId,
      human_player: state.humanPlayer,
      sims: state.sims,
      analysis_mode: state.analysisMode
    });
  }

  function setStatus(text) {
    const previous = state.status;
    state.status = text;
    els.statusChip.textContent = text;
    logDebug("DEBUG", "status.update", { previous: previous, next: text });
  }

  function showSession() {
    els.sessionChip.textContent = state.sessionId ? state.sessionId : "no session";
    logDebug("DEBUG", "session.chip", { session_id: state.sessionId || null });
  }

  function uniqueBases(candidates) {
    const seen = new Set();
    return candidates.filter(function (b) {
      const key = String(b || "").replace(/\/+$/, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(function (b) {
      return String(b).replace(/\/+$/, "");
    });
  }

  function candidateApiBases() {
    const configured = String(state.apiBase || DEFAULT_API_BASE).trim();
    const host = typeof window !== "undefined" && window.location && window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return uniqueBases([configured, LOCAL_API_BASE]);
    }
    return uniqueBases([configured, SAME_ORIGIN_API_BASE, LOCAL_API_BASE]);
  }

  async function api(path, options, allowFallback) {
    const candidates = allowFallback === false ? uniqueBases([state.apiBase || DEFAULT_API_BASE]) : candidateApiBases();
    const method = (options && options.method) || "GET";
    let requestBody = null;
    if (options && typeof options.body === "string") {
      requestBody = options.body.length > 3000 ? options.body.slice(0, 3000) + "...[truncated]" : options.body;
    }
    let lastErr = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const base = candidates[i];
      const started = performance.now();
      logDebug("DEBUG", "api.request", {
        method: method,
        path: path,
        url: base + path,
        body: requestBody,
        attempt: i + 1,
        candidates: candidates
      });
      try {
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
        const elapsed = Math.round(performance.now() - started);
        logDebug("DEBUG", "api.response", {
          method: method,
          path: path,
          status: response.status,
          ok: response.ok,
          elapsed_ms: elapsed,
          base: base,
          payload_preview: payload && safeSerialize(payload).slice(0, 3000)
        });
        if (!response.ok) {
          const detail = payload && (payload.detail || payload.message || JSON.stringify(payload));
          if (i < candidates.length - 1 && response.status >= 500) {
            logDebug("WARN", "api.retry", {
              method: method,
              path: path,
              base: base,
              status: response.status,
              reason: "server_error"
            });
            continue;
          }
          throw new Error("HTTP " + response.status + (detail ? (": " + detail) : ""));
        }
        if (state.apiBase !== base) {
          const previousBase = state.apiBase;
          state.apiBase = base;
          if (els.backendUrl) els.backendUrl.value = base;
          persist();
          logDebug("INFO", "api.base.switch", { selected: base, previous: previousBase });
        }
        return payload;
      } catch (err) {
        lastErr = err;
        if (i < candidates.length - 1) {
          logDebug("WARN", "api.retry", {
            method: method,
            path: path,
            base: base,
            reason: err && err.message ? err.message : "request_failed"
          });
          continue;
        }
      }
    }
    if (lastErr && /fetch|network|failed/i.test(String(lastErr.message || ""))) {
      throw new Error("Network error. Checked API bases: " + candidates.join(", ") + ". Verify DNS/proxy/backend health.");
    }
    throw lastErr || new Error("Request failed");
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
      logDebug("DEBUG", "ai.poll.stop", {});
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
    logDebug("DEBUG", "latent.push", {
      latent_dim: latent.length,
      latent_history_size: state.latentHistory.length
    });
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
    logDebug("DEBUG", "analysis.apply", {
      value: v,
      policy_size: Array.isArray(analysis.policy) ? analysis.policy.length : 0,
      policy_top5: summarizeArrayTop(analysis.policy || [], 5),
      latent_dim: Array.isArray(analysis.latent) ? analysis.latent.length : 0,
      progress: progress || null
    });
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
    logDebug("DEBUG", "render.all", {
      has_session_state: Boolean(state.sessionState),
      result: state.sessionState ? state.sessionState.result : null,
      to_play: state.sessionState ? state.sessionState.to_play : null,
      legal_actions: state.sessionState ? state.sessionState.legal_actions : []
    });
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
    logDebug("DEBUG", "archive.detail", {
      game_id: game.gameId,
      position_id: pos.id,
      label: pos.label,
      category: pos.category
    });
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
        logDebug("DEBUG", "archive.position.select", { game_id: archiveState.gameId, position_id: pos.id });
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
      logDebug("DEBUG", "archive.game.select", { game_id: archiveState.gameId, position_id: archiveState.positionId });
      renderArchiveList();
    });
    renderArchiveList();
    logDebug("DEBUG", "archive.init", {
      game_count: archiveState.data.length,
      default_game: archiveState.gameId,
      default_position: archiveState.positionId
    });
  }

  async function refreshAnalysis() {
    if (!state.sessionId || state.aiJobId) return;
    try {
      logDebug("DEBUG", "analysis.refresh.start", { session_id: state.sessionId });
      const analysis = await api("/api/v1/analyze", {
        method: "POST",
        body: JSON.stringify({ session_id: state.sessionId })
      });
      applyAnalysis(analysis, null);
      renderAll();
      logDebug("DEBUG", "analysis.refresh.done", { session_id: state.sessionId });
    } catch (err) {
      setStatus("analyze error: " + err.message);
      logDebug("ERROR", "analysis.refresh.error", { error: err.message });
    }
  }

  async function playHumanMove(action) {
    if (!state.sessionId || !isHumanTurn() || state.aiJobId) return;
    try {
      logDebug("DEBUG", "move.human.start", { action: action, session_id: state.sessionId });
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
      logDebug("DEBUG", "move.human.done", {
        action: action,
        result: state.sessionState.result,
        next_to_play: state.sessionState.to_play
      });
    } catch (err) {
      setStatus("move rejected: " + err.message);
      logDebug("ERROR", "move.human.error", { action: action, error: err.message });
    }
  }

  async function runAiMoveBlocking() {
    try {
      logDebug("DEBUG", "move.ai.blocking.start", { sims: state.sims, session_id: state.sessionId });
      setStatus("AI thinking...");
      const payload = await api("/api/v1/session/" + encodeURIComponent(state.sessionId) + "/ai-move", {
        method: "POST",
        body: JSON.stringify({ sims: state.sims, temperature: 0.0, emit_every: 50 })
      });
      state.sessionState = payload.state_after;
      applyAnalysis(payload.analysis, payload.progress || null);
      setStatus("AI moved");
      renderAll();
      logDebug("DEBUG", "move.ai.blocking.done", {
        action: payload.move && payload.move.action,
        result: state.sessionState.result,
        next_to_play: state.sessionState.to_play
      });
    } catch (err) {
      setStatus("AI error: " + err.message);
      logDebug("ERROR", "move.ai.blocking.error", { error: err.message });
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
        logDebug("DEBUG", "ai.job.running", {
          job_id: state.aiJobId,
          progress: payload.progress || null
        });
        return;
      }
      if (payload.status === "done") {
        state.sessionState = payload.state_after;
        state.aiJobId = null;
        stopPolling();
        setStatus("AI moved");
        renderAll();
        logDebug("DEBUG", "ai.job.done", {
          job_id: payload.job_id || state.aiJobId,
          action: payload.move && payload.move.action,
          result: state.sessionState.result
        });
        return;
      }
      state.aiJobId = null;
      stopPolling();
      setStatus("AI job error: " + (payload.error || "unknown"));
      renderAll();
      logDebug("ERROR", "ai.job.error", { job_id: state.aiJobId, error: payload.error || "unknown" });
    } catch (err) {
      state.aiJobId = null;
      stopPolling();
      setStatus("job poll failed: " + err.message);
      renderAll();
      logDebug("ERROR", "ai.job.poll.error", { job_id: state.aiJobId, error: err.message });
    }
  }

  async function startAiJob() {
    try {
      logDebug("DEBUG", "ai.job.start.request", { session_id: state.sessionId, sims: state.sims });
      setStatus("AI thinking...");
      const payload = await api("/api/v1/session/" + encodeURIComponent(state.sessionId) + "/ai-move/start", {
        method: "POST",
        body: JSON.stringify({ sims: state.sims, temperature: 0.0, emit_every: 25 })
      });
      state.aiJobId = payload.job_id;
      stopPolling();
      state.pollingTimer = window.setInterval(pollAiJob, 100);
      logDebug("DEBUG", "ai.job.start.accepted", { job_id: state.aiJobId });
    } catch (err) {
      setStatus("AI start failed: " + err.message);
      logDebug("ERROR", "ai.job.start.error", { error: err.message });
    }
  }

  function maybeStartAiTurn() {
    if (!state.sessionState || state.sessionState.result !== "ongoing") return;
    if (!isAiTurn()) return;
    logDebug("DEBUG", "turn.ai.detected", { analysis_mode: state.analysisMode });
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
      logDebug("DEBUG", "session.start.request", {
        game_id: state.gameId,
        human_player: state.humanPlayer,
        sims: state.sims,
        analysis_mode: state.analysisMode,
        api_base: state.apiBase
      });
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
      logDebug("DEBUG", "session.start.done", {
        session_id: state.sessionId,
        result: state.sessionState.result,
        to_play: state.sessionState.to_play
      });
    } catch (err) {
      state.sessionId = null;
      state.sessionState = null;
      showSession();
      setStatus("start failed: " + err.message);
      renderAll();
      logDebug("ERROR", "session.start.error", { error: err.message });
    }
  }

  function bindEvents() {
    els.backendUrl.addEventListener("change", function () {
      state.apiBase = els.backendUrl.value.trim() || DEFAULT_API_BASE;
      persist();
      logDebug("DEBUG", "ui.backend_url.change", { api_base: state.apiBase });
    });
    els.gameSelect.addEventListener("change", function () {
      state.gameId = els.gameSelect.value;
      const def = GAME_META[state.gameId].defaultSims;
      if (!Number.isFinite(state.sims) || state.sims <= 0) state.sims = def;
      els.aiSims.value = String(state.sims);
      persist();
      renderAll();
      logDebug("DEBUG", "ui.game.change", { game_id: state.gameId, sims: state.sims });
    });
    els.aiSims.addEventListener("change", function () {
      const n = Number(els.aiSims.value);
      state.sims = Number.isFinite(n) && n > 0 ? Math.round(n) : GAME_META[state.gameId].defaultSims;
      els.aiSims.value = String(state.sims);
      persist();
      logDebug("DEBUG", "ui.sims.change", { sims: state.sims });
    });
    els.humanSide.addEventListener("change", function () {
      state.humanPlayer = Number(els.humanSide.value) >= 0 ? 1 : -1;
      persist();
      logDebug("DEBUG", "ui.human_side.change", { human_player: state.humanPlayer });
    });
    els.analysisLive.addEventListener("change", function () {
      state.analysisMode = els.analysisLive.value === "off" ? "off" : "live";
      persist();
      logDebug("DEBUG", "ui.analysis_mode.change", { analysis_mode: state.analysisMode });
    });
    els.startBtn.addEventListener("click", startSession);
    els.passBtn.addEventListener("click", function () {
      logDebug("DEBUG", "ui.pass.click", { attempted: true });
      playHumanMove(64);
    });
    if (els.archiveRoot) {
      els.archiveRoot.addEventListener("toggle", function () {
        logDebug("DEBUG", "archive.toggle", { open: Boolean(els.archiveRoot.open) });
        if (els.archiveRoot.open) initArchive();
      });
    }
  }

  function init() {
    logDebug("DEBUG", "app.init.start", {
      version_hint: "boardspace_atlas_live_debug_v1",
      location: window.location.href,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    els.backendUrl.value = state.apiBase;
    els.gameSelect.value = state.gameId;
    els.aiSims.value = String(state.sims);
    els.humanSide.value = String(state.humanPlayer);
    els.analysisLive.value = state.analysisMode;
    showSession();
    bindEvents();
    renderAll();
    if (els.archiveRoot && els.archiveRoot.open) initArchive();
    logDebug("DEBUG", "app.init.done", {
      game_id: state.gameId,
      api_base: state.apiBase,
      human_player: state.humanPlayer,
      sims: state.sims,
      analysis_mode: state.analysisMode
    });
  }

  init();
})();
