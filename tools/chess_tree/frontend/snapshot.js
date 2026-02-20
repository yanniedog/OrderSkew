import { SNAPSHOT_SCHEMA_VERSION } from "./constants.js";

export function buildSnapshot(state) {
  const nodes = Array.from(state.tree.values()).map((node) => ({
    hash: String(node.hash),
    fen: node.fen,
    depth: node.depth,
    parentHash: node.parentHash != null ? String(node.parentHash) : null,
    moveSequence: node.moveSequence || "",
    eval: node.eval ?? null,
    bestMove: node.bestMove ?? null,
    gameResult: node.gameResult ?? null,
    parents: (node.parents || []).map((parent) => ({
      parentHash: String(parent.parentHash || ""),
      move: String(parent.move || ""),
      moveIndex: Number(parent.moveIndex || 0)
    })),
    inDegree: Number(node.inDegree || 0),
    outDegree: Number(node.outDegree || 0),
    transposition: Boolean(node.transposition),
    children: (node.children || []).map((child) => ({
      move: child.move,
      childHash: String(child.childHash)
    }))
  }));

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    meta: {
      createdAt: new Date().toISOString(),
      seedFen: state.settings.seedFen,
      depth: state.settings.depth,
      branching: state.settings.branchCap,
      nodeCap: state.settings.nodeCap,
      engineMode: state.mode
    },
    nodes,
    stats: state.stats
  };
}

export function parseSnapshot(json) {
  if (!json || typeof json !== "object") throw new Error("Snapshot must be an object");
  if (json.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("Unsupported snapshot schema version: " + String(json.schemaVersion));
  }
  if (!Array.isArray(json.nodes) || json.nodes.length === 0) {
    throw new Error("Snapshot has no nodes");
  }

  const nodes = json.nodes.map((node) => ({
    hash: String(node.hash),
    fen: String(node.fen || ""),
    depth: Number(node.depth || 0),
    parentHash: node.parentHash == null ? null : String(node.parentHash),
    moveSequence: String(node.moveSequence || ""),
    eval: node.eval == null ? null : Number(node.eval),
    bestMove: node.bestMove == null ? null : String(node.bestMove),
    gameResult: node.gameResult == null ? null : String(node.gameResult),
    parents: Array.isArray(node.parents)
      ? node.parents.map((parent) => ({
          parentHash: String(parent.parentHash || parent.parent_hash || ""),
          move: String(parent.move || parent.move_uci || ""),
          moveIndex: Number(parent.moveIndex || parent.move_index || 0)
        }))
      : [],
    inDegree: Number(node.inDegree || node.in_degree || 0),
    outDegree: Number(node.outDegree || node.out_degree || 0),
    transposition: Boolean(node.transposition),
    children: Array.isArray(node.children)
      ? node.children.map((child) => ({ move: String(child.move || ""), childHash: String(child.childHash) }))
      : []
  }));

  const root = nodes.find((n) => n.parentHash === null) || nodes[0];

  return {
    rootHash: root.hash,
    nodes,
    stats: {
      totalPositions: Number(json.stats?.totalPositions || nodes.length),
      totalEdges: Number(
        json.stats?.totalEdges || nodes.reduce((sum, node) => sum + (Array.isArray(node.children) ? node.children.length : 0), 0)
      ),
      maxDepth: Number(json.stats?.maxDepth || nodes.reduce((m, n) => Math.max(m, n.depth), 0)),
      throughput: Number(json.stats?.throughput || 0),
      elapsedMs: Number(json.stats?.elapsedMs || 0)
    },
    meta: json.meta || {}
  };
}

export function downloadSnapshot(snapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = "chess-tree-snapshot-" + stamp + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
