const DEFAULT_SETTINGS = {
  seedFen: "start",
  depth: 3,
  branchCap: 12,
  nodeCap: 1500
};

function materialScoreFromFen(fen) {
  const [board] = fen.split(" ");
  const weights = {
    p: -100,
    n: -320,
    b: -330,
    r: -500,
    q: -900,
    k: 0,
    P: 100,
    N: 320,
    B: 330,
    R: 500,
    Q: 900,
    K: 0
  };
  let score = 0;
  for (const char of board) {
    if (weights[char]) score += weights[char];
  }
  return score;
}

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString();
}

function normaliseFen(seedFen) {
  return seedFen && seedFen !== "start" ? seedFen : undefined;
}

let paused = false;
let cancelled = false;

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};

  if (type === "pause") {
    paused = true;
    return;
  }

  if (type === "resume") {
    paused = false;
    return;
  }

  if (type === "cancel") {
    cancelled = true;
    return;
  }

  if (type !== "generate") return;

  cancelled = false;
  paused = false;

  try {
    importScripts("./assets/chess.min.js");
  } catch (err) {
    self.postMessage({ type: "error", payload: { message: "Failed to load chess engine: " + String(err) } });
    return;
  }

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(payload || {})
  };

  const rootGame = new self.Chess(normaliseFen(settings.seedFen));
  const rootFen = rootGame.fen();
  const rootHash = hashString(rootFen + "|0|root");

  const nodes = new Map();
  const queue = [];

  const rootNode = {
    hash: rootHash,
    fen: rootFen,
    depth: 0,
    parentHash: null,
    moveSequence: "",
    eval: materialScoreFromFen(rootFen),
    bestMove: null,
    gameResult: null,
    children: []
  };

  nodes.set(rootHash, rootNode);
  queue.push(rootNode);

  const startedAt = Date.now();
  let expanded = 0;
  let emittedAt = startedAt;

  while (queue.length > 0) {
    if (cancelled) {
      self.postMessage({ type: "cancelled" });
      return;
    }

    while (paused && !cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    const node = queue.shift();
    if (!node || node.depth >= settings.depth) continue;

    const game = new self.Chess(node.fen);
    const moves = game.moves({ verbose: true }).slice(0, settings.branchCap);

    if (moves.length === 0) {
      const gameOver = game.game_over && game.game_over();
      if (gameOver) {
        if (game.in_checkmate && game.in_checkmate()) {
          node.gameResult = game.turn() === "w" ? "0-1" : "1-0";
        } else {
          node.gameResult = "1/2-1/2";
        }
      }
      continue;
    }

    node.bestMove = moves[0].san || moves[0].from + moves[0].to;

    for (const move of moves) {
      if (nodes.size >= settings.nodeCap) break;
      const child = new self.Chess(node.fen);
      child.move(move);
      const childFen = child.fen();
      const childHash = hashString(childFen + "|" + (node.depth + 1) + "|" + node.hash + "|" + move.san);
      const childNode = {
        hash: childHash,
        fen: childFen,
        depth: node.depth + 1,
        parentHash: node.hash,
        moveSequence: node.moveSequence ? node.moveSequence + " " + move.san : move.san,
        eval: materialScoreFromFen(childFen),
        bestMove: null,
        gameResult: null,
        children: []
      };
      nodes.set(childHash, childNode);
      node.children.push({
        move: move.san,
        childHash
      });
      queue.push(childNode);
    }

    expanded += 1;
    const now = Date.now();
    if (now - emittedAt >= 120) {
      self.postMessage({
        type: "progress",
        payload: {
          nodes: nodes.size,
          expanded,
          queue: queue.length,
          elapsedMs: now - startedAt
        }
      });
      emittedAt = now;
    }

    if (nodes.size >= settings.nodeCap) break;
  }

  const elapsedMs = Date.now() - startedAt;
  const exportedNodes = Array.from(nodes.values());
  const stats = {
    totalPositions: exportedNodes.length,
    totalEdges: exportedNodes.reduce((sum, n) => sum + n.children.length, 0),
    maxDepth: exportedNodes.reduce((max, n) => Math.max(max, n.depth), 0),
    throughput: elapsedMs > 0 ? Number((exportedNodes.length / (elapsedMs / 1000)).toFixed(2)) : 0,
    elapsedMs
  };

  self.postMessage({
    type: "complete",
    payload: {
      rootHash,
      nodes: exportedNodes,
      stats,
      limitsHit: exportedNodes.length >= settings.nodeCap
    }
  });
};
