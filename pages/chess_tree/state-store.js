import { ENGINE_MODES, STORAGE_KEYS, DEFAULT_SETTINGS } from "./constants.js";

const state = {
  mode: localStorage.getItem(STORAGE_KEYS.MODE) || ENGINE_MODES.BROWSER,
  remoteApiBase: localStorage.getItem(STORAGE_KEYS.REMOTE_API_BASE) || "",
  settings: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || "{}");
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  })(),
  status: "idle",
  activeHash: null,
  rootHash: null,
  tree: new Map(),
  stats: {
    totalPositions: 0,
    totalEdges: 0,
    maxDepth: 0,
    throughput: 0,
    elapsedMs: 0
  }
};

const subscribers = new Set();

function persist() {
  localStorage.setItem(STORAGE_KEYS.MODE, state.mode);
  localStorage.setItem(STORAGE_KEYS.REMOTE_API_BASE, state.remoteApiBase);
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
}

function notify() {
  for (const callback of subscribers) callback(state);
}

export function subscribe(callback) {
  subscribers.add(callback);
  callback(state);
  return () => subscribers.delete(callback);
}

export function setMode(mode) {
  state.mode = mode;
  persist();
  notify();
}

export function setRemoteApiBase(value) {
  state.remoteApiBase = value.trim();
  persist();
  notify();
}

export function setSettings(partial) {
  state.settings = { ...state.settings, ...partial };
  persist();
  notify();
}

export function setStatus(status) {
  state.status = status;
  notify();
}

export function setTree({ rootHash, nodes, stats }) {
  state.tree = new Map(nodes.map((node) => [String(node.hash), node]));
  state.rootHash = String(rootHash);
  state.activeHash = String(rootHash);
  state.stats = { ...state.stats, ...stats };
  notify();
}

export function patchStats(stats) {
  state.stats = { ...state.stats, ...stats };
  notify();
}

export function setActiveHash(hash) {
  state.activeHash = String(hash);
  notify();
}

export function resetTree() {
  state.tree = new Map();
  state.rootHash = null;
  state.activeHash = null;
  state.status = "idle";
  state.stats = {
    totalPositions: 0,
    totalEdges: 0,
    maxDepth: 0,
    throughput: 0,
    elapsedMs: 0
  };
  notify();
}

export function getState() {
  return state;
}
