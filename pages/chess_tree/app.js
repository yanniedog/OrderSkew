import { ENGINE_MODES, LIMITS } from "./constants.js";
import {
  subscribe,
  setMode,
  setRemoteApiBase,
  setSettings,
  setStatus,
  setTree,
  patchStats,
  setActiveHash,
  resetTree,
  getState
} from "./state-store.js";
import { fetchRoot, fetchPosition, fetchStats, fetchMetrics, searchPositions } from "./api-adapter.js";
import { renderBoard } from "./board.js";
import { renderTree } from "./tree-view.js";
import { buildSnapshot, downloadSnapshot, parseSnapshot } from "./snapshot.js";

const worker = new Worker("./engine.worker.js");
const expanded = new Set();

const el = {
  modeBrowser: document.getElementById("mode-browser"),
  modeRemote: document.getElementById("mode-remote"),
  remoteApiBase: document.getElementById("remote-api-base"),
  seedFen: document.getElementById("seed-fen"),
  depth: document.getElementById("depth"),
  branchCap: document.getElementById("branch-cap"),
  nodeCap: document.getElementById("node-cap"),
  run: document.getElementById("run"),
  pause: document.getElementById("pause"),
  resume: document.getElementById("resume"),
  cancel: document.getElementById("cancel"),
  reset: document.getElementById("reset"),
  refreshRemote: document.getElementById("refresh-remote"),
  statusChip: document.getElementById("status-chip"),
  errorBanner: document.getElementById("error-banner"),
  tree: document.getElementById("tree"),
  activeNodeLabel: document.getElementById("active-node-label"),
  board: document.getElementById("board"),
  meta: document.getElementById("meta"),
  stPositions: document.getElementById("st-positions"),
  stEdges: document.getElementById("st-edges"),
  stDepth: document.getElementById("st-depth"),
  stThroughput: document.getElementById("st-throughput"),
  search: document.getElementById("search"),
  searchBtn: document.getElementById("search-btn"),
  exportJson: document.getElementById("export-json"),
  importJson: document.getElementById("import-json"),
  importFile: document.getElementById("import-file")
};

function setError(message) {
  if (!message) {
    el.errorBanner.style.display = "none";
    el.errorBanner.textContent = "";
    return;
  }
  el.errorBanner.style.display = "block";
  el.errorBanner.textContent = message;
}

function selectedNode(state) {
  if (!state.activeHash || state.tree.size === 0) return null;
  return state.tree.get(String(state.activeHash)) || null;
}

function updateStatsView(state) {
  el.stPositions.textContent = String(state.stats.totalPositions || 0);
  el.stEdges.textContent = String(state.stats.totalEdges || 0);
  el.stDepth.textContent = String(state.stats.maxDepth || 0);
  el.stThroughput.textContent = String(state.stats.throughput || 0);
}

function updateModeButtons(state) {
  const browser = state.mode === ENGINE_MODES.BROWSER;
  el.modeBrowser.className = browser ? "primary" : "ghost";
  el.modeRemote.className = browser ? "ghost" : "primary";
}

function updateSelectionPanel(state) {
  const node = selectedNode(state);
  if (!node) {
    el.activeNodeLabel.textContent = "no node";
    el.meta.textContent = "No selection yet.";
    renderBoard(el.board, "8/8/8/8/8/8/8/8 w - - 0 1");
    return;
  }
  el.activeNodeLabel.textContent = String(node.hash);
  renderBoard(el.board, node.fen);
  const lines = [
    "FEN: " + node.fen,
    "Depth: " + node.depth,
    "Eval: " + (node.eval == null ? "-" : (Number(node.eval) / 100).toFixed(2)),
    "Move sequence: " + (node.moveSequence || "ROOT"),
    "Best move: " + (node.bestMove || "-"),
    "Game result: " + (node.gameResult || "-")
  ];
  el.meta.textContent = lines.join("\n");
}

function ensureExpanded(hash) {
  if (!hash) return;
  let current = getState().tree.get(String(hash));
  while (current) {
    expanded.add(String(current.hash));
    if (!current.parentHash) break;
    current = getState().tree.get(String(current.parentHash));
  }
}

function handleSelect(hash) {
  setActiveHash(hash);
  ensureExpanded(hash);
}

function handleToggle(hash) {
  const key = String(hash);
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  renderTree(el.tree, getState(), expanded, handleSelect, handleToggle);
}

async function runBrowserGeneration() {
  setError("");
  const state = getState();
  setStatus("running");
  worker.postMessage({
    type: "generate",
    payload: {
      seedFen: state.settings.seedFen,
      depth: state.settings.depth,
      branchCap: state.settings.branchCap,
      nodeCap: state.settings.nodeCap
    }
  });
}

async function loadRemoteRootAndStats() {
  const state = getState();
  if (!state.remoteApiBase) throw new Error("Remote API base URL is required");
  setStatus("loading-remote");
  setError("");

  const root = await fetchRoot(state.remoteApiBase);
  const stats = await fetchStats(state.remoteApiBase);

  const map = new Map();
  const queue = [root];
  map.set(String(root.hash), {
    hash: String(root.hash),
    fen: root.fen,
    depth: Number(root.depth || 0),
    parentHash: root.parent_hash == null ? null : String(root.parent_hash),
    moveSequence: root.move_sequence || "",
    eval: root.evaluation_score,
    bestMove: root.best_move,
    gameResult: root.game_result,
    children: (root.children || []).map((c) => ({ move: c.move_uci || c.move || "", childHash: String(c.child_hash || c.childHash) }))
  });

  const HARD_REMOTE_LOAD = 180;
  while (queue.length > 0 && map.size < HARD_REMOTE_LOAD) {
    const parent = queue.shift();
    for (const child of parent.children || []) {
      const childHash = String(child.child_hash || child.childHash);
      if (map.has(childHash)) continue;
      const next = await fetchPosition(state.remoteApiBase, childHash);
      const node = {
        hash: String(next.hash),
        fen: next.fen,
        depth: Number(next.depth || 0),
        parentHash: next.parent_hash == null ? null : String(next.parent_hash),
        moveSequence: next.move_sequence || "",
        eval: next.evaluation_score,
        bestMove: next.best_move,
        gameResult: next.game_result,
        children: (next.children || []).map((c) => ({ move: c.move_uci || c.move || "", childHash: String(c.child_hash || c.childHash) }))
      };
      map.set(node.hash, node);
      queue.push(next);
      if (map.size >= HARD_REMOTE_LOAD) break;
    }
  }

  setTree({
    rootHash: String(root.hash),
    nodes: Array.from(map.values()),
    stats: {
      totalPositions: Number(stats.total_positions || stats.totalPositions || map.size),
      totalEdges: Number(stats.total_edges || stats.totalEdges || 0),
      maxDepth: Number(stats.max_depth || stats.maxDepth || 0),
      throughput: 0,
      elapsedMs: 0
    }
  });

  expanded.clear();
  expanded.add(String(root.hash));

  try {
    const metrics = await fetchMetrics(state.remoteApiBase);
    patchStats({ throughput: Number(metrics.positions_per_second || 0), elapsedMs: Number((metrics.elapsed_seconds || 0) * 1000) });
  } catch {
    // optional endpoint
  }

  setStatus("ready");
}

function wireEvents() {
  el.modeBrowser.addEventListener("click", () => setMode(ENGINE_MODES.BROWSER));
  el.modeRemote.addEventListener("click", () => setMode(ENGINE_MODES.REMOTE));

  el.remoteApiBase.addEventListener("change", () => setRemoteApiBase(el.remoteApiBase.value));

  el.seedFen.addEventListener("change", () => setSettings({ seedFen: el.seedFen.value.trim() || "start" }));
  el.depth.addEventListener("change", () => {
    const value = Math.max(LIMITS.MIN_DEPTH, Math.min(LIMITS.MAX_DEPTH, Number(el.depth.value || 3)));
    el.depth.value = String(value);
    setSettings({ depth: value });
  });
  el.branchCap.addEventListener("change", () => {
    const value = Math.max(LIMITS.MIN_BRANCH_CAP, Math.min(LIMITS.MAX_BRANCH_CAP, Number(el.branchCap.value || 12)));
    el.branchCap.value = String(value);
    setSettings({ branchCap: value });
  });
  el.nodeCap.addEventListener("change", () => {
    const value = Math.max(LIMITS.MIN_NODE_CAP, Math.min(LIMITS.MAX_NODE_CAP, Number(el.nodeCap.value || 1500)));
    el.nodeCap.value = String(value);
    setSettings({ nodeCap: value });
  });

  el.run.addEventListener("click", async () => {
    const state = getState();
    try {
      if (state.mode === ENGINE_MODES.BROWSER) {
        await runBrowserGeneration();
      } else {
        await loadRemoteRootAndStats();
      }
    } catch (err) {
      setStatus("error");
      setError(err.message || String(err));
    }
  });

  el.pause.addEventListener("click", () => {
    worker.postMessage({ type: "pause" });
    setStatus("paused");
  });

  el.resume.addEventListener("click", () => {
    worker.postMessage({ type: "resume" });
    setStatus("running");
  });

  el.cancel.addEventListener("click", () => {
    worker.postMessage({ type: "cancel" });
    setStatus("cancelled");
  });

  el.reset.addEventListener("click", () => {
    worker.postMessage({ type: "cancel" });
    resetTree();
    expanded.clear();
    setError("");
  });

  el.refreshRemote.addEventListener("click", async () => {
    try {
      await loadRemoteRootAndStats();
    } catch (err) {
      setStatus("error");
      setError(err.message || String(err));
    }
  });

  async function runSearch() {
    const query = el.search.value.trim();
    if (!query) return;
    const state = getState();

    try {
      if (state.mode === ENGINE_MODES.REMOTE) {
        const hashes = await searchPositions(state.remoteApiBase, query);
        if (!hashes.length) {
          setError("No remote match for query.");
          return;
        }
        const target = String(hashes[0]);
        if (!state.tree.has(target)) {
          const raw = await fetchPosition(state.remoteApiBase, target);
          const currentNodes = Array.from(state.tree.values());
          currentNodes.push({
            hash: String(raw.hash),
            fen: raw.fen,
            depth: Number(raw.depth || 0),
            parentHash: raw.parent_hash == null ? null : String(raw.parent_hash),
            moveSequence: raw.move_sequence || "",
            eval: raw.evaluation_score,
            bestMove: raw.best_move,
            gameResult: raw.game_result,
            children: (raw.children || []).map((c) => ({ move: c.move_uci || c.move || "", childHash: String(c.child_hash || c.childHash) }))
          });
          setTree({ rootHash: state.rootHash, nodes: currentNodes, stats: state.stats });
        }
        handleSelect(target);
      } else {
        const lower = query.toLowerCase();
        const matches = Array.from(state.tree.values()).filter((node) => {
          return (node.moveSequence || "").toLowerCase().includes(lower) || (node.fen || "").toLowerCase().includes(lower);
        });
        if (!matches.length) {
          setError("No local match for query.");
          return;
        }
        handleSelect(matches[0].hash);
      }
      setError("");
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  el.searchBtn.addEventListener("click", runSearch);
  el.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch();
    }
  });

  el.exportJson.addEventListener("click", () => {
    const state = getState();
    if (!state.rootHash || state.tree.size === 0) {
      setError("No tree data to export.");
      return;
    }
    downloadSnapshot(buildSnapshot(state));
    setError("");
  });

  el.importJson.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", async () => {
    const file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    try {
      const parsed = parseSnapshot(JSON.parse(await file.text()));
      setTree({ rootHash: parsed.rootHash, nodes: parsed.nodes, stats: parsed.stats });
      expanded.clear();
      expanded.add(String(parsed.rootHash));
      setStatus("imported");
      setError("");
    } catch (err) {
      setStatus("error");
      setError("Import failed: " + (err.message || String(err)));
    }
  });
}

worker.onmessage = (event) => {
  const { type, payload } = event.data || {};

  if (type === "progress") {
    patchStats({
      totalPositions: payload.nodes,
      throughput: payload.elapsedMs > 0 ? Number((payload.nodes / (payload.elapsedMs / 1000)).toFixed(2)) : 0,
      elapsedMs: payload.elapsedMs
    });
    return;
  }

  if (type === "complete") {
    setTree({ rootHash: payload.rootHash, nodes: payload.nodes, stats: payload.stats });
    expanded.clear();
    expanded.add(String(payload.rootHash));
    setStatus(payload.limitsHit ? "ready (limit hit)" : "ready");
    setError("");
    return;
  }

  if (type === "cancelled") {
    setStatus("cancelled");
    return;
  }

  if (type === "error") {
    setStatus("error");
    setError(payload.message || "Worker error");
  }
};

subscribe((state) => {
  el.remoteApiBase.value = state.remoteApiBase;
  el.seedFen.value = state.settings.seedFen;
  el.depth.value = String(state.settings.depth);
  el.branchCap.value = String(state.settings.branchCap);
  el.nodeCap.value = String(state.settings.nodeCap);
  el.statusChip.textContent = state.status;

  updateModeButtons(state);
  updateStatsView(state);
  updateSelectionPanel(state);

  if (!state.rootHash) {
    renderTree(el.tree, state, expanded, handleSelect, handleToggle);
    return;
  }

  if (!expanded.has(String(state.rootHash))) expanded.add(String(state.rootHash));
  renderTree(el.tree, state, expanded, handleSelect, handleToggle);
});

wireEvents();
resetTree();
renderBoard(el.board, "8/8/8/8/8/8/8/8 w - - 0 1");
