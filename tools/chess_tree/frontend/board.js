const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const PIECE_ASSETS = {
  p: "bP",
  r: "bR",
  n: "bN",
  b: "bB",
  q: "bQ",
  k: "bK",
  P: "wP",
  R: "wR",
  N: "wN",
  B: "wB",
  Q: "wQ",
  K: "wK"
};

const BOARD_STATE = new WeakMap();

function normalizeFen(fen) {
  const raw = String(fen || "").trim();
  if (!raw || raw.toLowerCase() === "start") return START_FEN;
  return raw;
}

function pieceColor(piece) {
  return piece === piece.toUpperCase() ? "w" : "b";
}

function clearHighlights(state) {
  for (const square of state.squares) {
    square.classList.remove("is-selected", "is-legal-target", "is-last-from", "is-last-to", "invalid-attempt", "drag-origin", "drop-target");
  }
}

function applyHighlights(state) {
  clearHighlights(state);

  if (state.selectedSquare) {
    const selected = state.squareByName.get(state.selectedSquare);
    if (selected) selected.classList.add("is-selected");
  }

  for (const target of state.legalTargets) {
    const square = state.squareByName.get(target);
    if (square) square.classList.add("is-legal-target");
  }

  if (state.lastMove) {
    const fromSquare = state.squareByName.get(state.lastMove.from);
    const toSquare = state.squareByName.get(state.lastMove.to);
    if (fromSquare) fromSquare.classList.add("is-last-from");
    if (toSquare) toSquare.classList.add("is-last-to");
  }

  if (state.dragFromSquare) {
    const source = state.squareByName.get(state.dragFromSquare);
    if (source) source.classList.add("drag-origin");
  }
}

function setInvalidAttempt(state, squareName) {
  const square = state.squareByName.get(squareName);
  if (!square) return;
  square.classList.add("invalid-attempt");
  if (state.invalidAttemptTimer) clearTimeout(state.invalidAttemptTimer);
  state.invalidAttemptTimer = setTimeout(() => {
    square.classList.remove("invalid-attempt");
    state.invalidAttemptTimer = null;
  }, 220);
}

function getLegalMovesForSquare(state, squareName) {
  if (!state.legalOnly) {
    return state.chess.SQUARES.map((target) => ({ from: squareName, to: target, promotion: undefined }));
  }
  return state.chess.moves({ square: squareName, verbose: true }) || [];
}

function setSelectedSquare(state, squareName) {
  state.selectedSquare = squareName;
  const moves = getLegalMovesForSquare(state, squareName);
  state.legalTargets = new Set(moves.map((move) => move.to));
  applyHighlights(state);
}

function clearSelection(state) {
  state.selectedSquare = null;
  state.legalTargets.clear();
  applyHighlights(state);
}

function emitMove(state, move) {
  state.currentFen = state.chess.fen();
  state.lastMove = { from: move.from, to: move.to };
  if (typeof state.onMove === "function") {
    state.onMove({
      fen: state.currentFen,
      from: move.from,
      to: move.to,
      piece: move.piece,
      san: move.san,
      uci: move.from + move.to + (move.promotion || ""),
      capture: Boolean(move.captured)
    });
  }
}

function tryMove(state, from, to) {
  if (!from || !to) return false;
  if (from === to) return false;

  const selectedPiece = state.chess.get(from);
  if (!selectedPiece) return false;

  if (state.legalOnly && selectedPiece.color !== state.chess.turn()) {
    setInvalidAttempt(state, from);
    return false;
  }

  const moveInput = { from, to };
  if (selectedPiece.type === "p" && (to.endsWith("8") || to.endsWith("1"))) {
    moveInput.promotion = "q";
  }

  const move = state.chess.move(moveInput);
  if (!move) {
    setInvalidAttempt(state, to);
    return false;
  }

  emitMove(state, move);
  clearSelection(state);
  renderPieces(state);
  applyHighlights(state);
  return true;
}

function onSquareActivate(state, squareName) {
  if (!state.interactive) return;

  if (state.selectedSquare && state.legalTargets.has(squareName)) {
    tryMove(state, state.selectedSquare, squareName);
    return;
  }

  const piece = state.chess.get(squareName);
  if (!piece) {
    clearSelection(state);
    return;
  }

  if (state.legalOnly && piece.color !== state.chess.turn()) {
    setInvalidAttempt(state, squareName);
    return;
  }

  setSelectedSquare(state, squareName);
}

function createPieceElement(state, squareName, pieceSymbol) {
  const image = document.createElement("img");
  image.className = "board-piece";
  image.alt = pieceSymbol;
  image.src = "./assets/pieces/" + PIECE_ASSETS[pieceSymbol] + ".svg";
  image.setAttribute("draggable", String(state.interactive));

  if (!state.interactive) return image;

  image.addEventListener("dragstart", (event) => {
    const piece = state.chess.get(squareName);
    if (!piece || (state.legalOnly && piece.color !== state.chess.turn())) {
      event.preventDefault();
      return;
    }

    const legalMoves = getLegalMovesForSquare(state, squareName);
    if (!legalMoves.length) {
      event.preventDefault();
      return;
    }

    state.dragFromSquare = squareName;
    setSelectedSquare(state, squareName);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", squareName);
    image.classList.add("is-dragging");
  });

  image.addEventListener("dragend", () => {
    image.classList.remove("is-dragging");
    state.dragFromSquare = null;
    applyHighlights(state);
  });

  image.addEventListener("click", (event) => {
    event.stopPropagation();
    onSquareActivate(state, squareName);
  });

  image.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    state.touchSourceSquare = squareName;
  });

  return image;
}

function renderPieces(state) {
  for (const square of state.squares) {
    const squareName = square.dataset.square;
    square.textContent = "";
    const piece = state.chess.get(squareName);
    if (!piece) continue;
    const symbol = piece.color === "w" ? piece.type.toUpperCase() : piece.type;
    square.appendChild(createPieceElement(state, squareName, symbol));
  }
}

function createChessInstance(fen) {
  const ChessCtor = globalThis.Chess;
  if (typeof ChessCtor !== "function") {
    throw new Error("Chess engine library is missing.");
  }

  const chess = new ChessCtor();
  const normalized = normalizeFen(fen);
  if (normalized !== START_FEN) {
    const ok = chess.load(normalized);
    if (!ok) throw new Error("Invalid FEN");
  }
  return chess;
}

function loadPosition(state, fen) {
  const normalized = normalizeFen(fen);
  try {
    state.chess = createChessInstance(normalized);
    state.currentFen = state.chess.fen();
  } catch {
    state.chess = createChessInstance(START_FEN);
    state.currentFen = START_FEN;
  }

  clearSelection(state);
  state.lastMove = null;
  state.dragFromSquare = null;
  state.touchSourceSquare = null;
  renderPieces(state);
  applyHighlights(state);
}

function createBoardState(container) {
  container.textContent = "";

  const state = {
    container,
    squares: [],
    squareByName: new Map(),
    chess: null,
    currentFen: "",
    interactive: true,
    legalOnly: true,
    onMove: null,
    selectedSquare: null,
    legalTargets: new Set(),
    lastMove: null,
    dragFromSquare: null,
    touchSourceSquare: null,
    invalidAttemptTimer: null
  };

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const squareName = FILES[file] + String(8 - rank);
      const square = document.createElement("button");
      square.type = "button";
      square.className = "board-square " + ((rank + file) % 2 === 0 ? "dark" : "light");
      square.dataset.square = squareName;

      square.addEventListener("click", () => onSquareActivate(state, squareName));

      square.addEventListener("dragover", (event) => {
        if (!state.interactive || !state.dragFromSquare) return;
        if (!state.legalTargets.has(squareName)) return;
        event.preventDefault();
        square.classList.add("drop-target");
      });

      square.addEventListener("dragleave", () => {
        square.classList.remove("drop-target");
      });

      square.addEventListener("drop", (event) => {
        if (!state.interactive || !state.dragFromSquare) return;
        event.preventDefault();
        const source = state.dragFromSquare;
        state.dragFromSquare = null;
        square.classList.remove("drop-target");
        tryMove(state, source, squareName);
      });

      square.addEventListener("pointerup", (event) => {
        if (!state.interactive || event.pointerType !== "touch") return;
        if (!state.touchSourceSquare) return;
        const source = state.touchSourceSquare;
        state.touchSourceSquare = null;
        if (source === squareName) {
          onSquareActivate(state, squareName);
          return;
        }
        tryMove(state, source, squareName);
      });

      state.squares.push(square);
      state.squareByName.set(squareName, square);
      container.appendChild(square);
    }
  }

  BOARD_STATE.set(container, state);
  loadPosition(state, START_FEN);
  return state;
}

function getBoardState(container) {
  return BOARD_STATE.get(container) || createBoardState(container);
}

export function renderBoard(container, fen, options = {}) {
  const state = getBoardState(container);

  state.interactive = options.interactive !== false;
  state.legalOnly = options.legalOnly !== false;
  state.onMove = typeof options.onMove === "function" ? options.onMove : null;
  state.container.classList.toggle("interactive", state.interactive);

  const normalized = normalizeFen(fen);
  if (normalized !== state.currentFen) {
    loadPosition(state, normalized);
  } else {
    renderPieces(state);
    applyHighlights(state);
  }
}
