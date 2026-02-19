const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const PIECES = {
  p: "\u265F",
  r: "\u265C",
  n: "\u265E",
  b: "\u265D",
  q: "\u265B",
  k: "\u265A",
  P: "\u2659",
  R: "\u2656",
  N: "\u2658",
  B: "\u2657",
  Q: "\u2655",
  K: "\u2654"
};

const BOARD_STATE = new WeakMap();

function normalizeFen(fen) {
  const raw = String(fen || "").trim();
  if (!raw || raw.toLowerCase() === "start") return START_FEN;
  return raw;
}

function indexToSquare(index) {
  const file = index % 8;
  const rank = 8 - Math.floor(index / 8);
  return FILES[file] + String(rank);
}

function emptyPosition() {
  return {
    board: new Array(64).fill(""),
    activeColor: "w",
    castling: "-",
    enPassant: "-",
    halfmoveClock: 0,
    fullmoveNumber: 1
  };
}

function parseFenPosition(fen) {
  const normalized = normalizeFen(fen);
  const [placement = "", active = "w", castling = "-", enPassant = "-", halfmove = "0", fullmove = "1"] = normalized.split(/\s+/);
  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error("Invalid FEN rows");

  const parsed = emptyPosition();
  parsed.activeColor = active === "b" ? "b" : "w";
  parsed.castling = castling && castling !== "" ? castling : "-";
  parsed.enPassant = enPassant && enPassant !== "" ? enPassant : "-";
  parsed.halfmoveClock = Number.isFinite(Number(halfmove)) ? Number(halfmove) : 0;
  parsed.fullmoveNumber = Math.max(1, Number.isFinite(Number(fullmove)) ? Number(fullmove) : 1);

  for (let rank = 0; rank < 8; rank += 1) {
    const row = rows[rank];
    let file = 0;
    for (const token of row) {
      if (/\d/.test(token)) {
        file += Number(token);
        continue;
      }
      if (file > 7) throw new Error("Invalid FEN columns");
      parsed.board[rank * 8 + file] = token;
      file += 1;
    }
    if (file !== 8) throw new Error("Invalid FEN row width");
  }

  return parsed;
}

function serializeFen(position) {
  const rows = [];
  for (let rank = 0; rank < 8; rank += 1) {
    let row = "";
    let empties = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = position.board[rank * 8 + file] || "";
      if (!piece) {
        empties += 1;
        continue;
      }
      if (empties > 0) {
        row += String(empties);
        empties = 0;
      }
      row += piece;
    }
    if (empties > 0) row += String(empties);
    rows.push(row);
  }

  const castling = position.castling && position.castling.length > 0 ? position.castling : "-";
  const enPassant = position.enPassant || "-";
  return [
    rows.join("/"),
    position.activeColor,
    castling,
    enPassant,
    String(position.halfmoveClock),
    String(position.fullmoveNumber)
  ].join(" ");
}

function removeCastlingRight(position, right) {
  if (!position.castling || position.castling === "-") return;
  position.castling = position.castling.replace(right, "");
  if (!position.castling) position.castling = "-";
}

function updateMoveMeta(position, piece, fromSquare, toSquare, capture) {
  const lower = piece.toLowerCase();
  const movedByWhite = piece === piece.toUpperCase();

  if (lower === "k") {
    if (movedByWhite) {
      removeCastlingRight(position, "K");
      removeCastlingRight(position, "Q");
    } else {
      removeCastlingRight(position, "k");
      removeCastlingRight(position, "q");
    }
  }

  if (lower === "r") {
    if (fromSquare === "a1") removeCastlingRight(position, "Q");
    if (fromSquare === "h1") removeCastlingRight(position, "K");
    if (fromSquare === "a8") removeCastlingRight(position, "q");
    if (fromSquare === "h8") removeCastlingRight(position, "k");
  }

  if (capture) {
    if (toSquare === "a1") removeCastlingRight(position, "Q");
    if (toSquare === "h1") removeCastlingRight(position, "K");
    if (toSquare === "a8") removeCastlingRight(position, "q");
    if (toSquare === "h8") removeCastlingRight(position, "k");
  }

  position.halfmoveClock = lower === "p" || capture ? 0 : position.halfmoveClock + 1;
  position.enPassant = "-";
  position.activeColor = position.activeColor === "w" ? "b" : "w";
  if (position.activeColor === "w") position.fullmoveNumber += 1;
}

function clearDragClasses(state) {
  for (const square of state.squares) {
    square.classList.remove("drag-origin", "drop-target");
  }
}

function movePiece(state, fromIndex, toIndex) {
  if (fromIndex === toIndex) return false;

  const piece = state.position.board[fromIndex];
  if (!piece) return false;

  const capture = Boolean(state.position.board[toIndex]);
  const fromSquare = indexToSquare(fromIndex);
  const toSquare = indexToSquare(toIndex);

  state.position.board[toIndex] = piece;
  state.position.board[fromIndex] = "";
  updateMoveMeta(state.position, piece, fromSquare, toSquare, capture);

  state.fen = serializeFen(state.position);
  if (typeof state.onMove === "function") {
    state.onMove({
      fen: state.fen,
      from: fromSquare,
      to: toSquare,
      piece,
      capture
    });
  }

  return true;
}

function createPieceElement(state, piece, fromIndex) {
  const pieceEl = document.createElement("span");
  pieceEl.className = "board-piece";
  pieceEl.textContent = PIECES[piece] || "";

  if (!state.interactive) return pieceEl;

  pieceEl.draggable = true;
  pieceEl.addEventListener("dragstart", (event) => {
    state.dragFromIndex = fromIndex;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", indexToSquare(fromIndex));

    const sourceSquare = state.squares[fromIndex];
    if (sourceSquare) sourceSquare.classList.add("drag-origin");

    requestAnimationFrame(() => {
      pieceEl.classList.add("dragging");
    });
  });

  pieceEl.addEventListener("dragend", () => {
    pieceEl.classList.remove("dragging");
    clearDragClasses(state);
    state.dragFromIndex = null;
  });

  return pieceEl;
}

function renderSquares(state) {
  for (let index = 0; index < 64; index += 1) {
    const squareEl = state.squares[index];
    squareEl.innerHTML = "";
    const piece = state.position.board[index] || "";
    if (!piece) continue;
    squareEl.appendChild(createPieceElement(state, piece, index));
  }
}

function createBoardState(container) {
  container.innerHTML = "";

  const state = {
    container,
    squares: [],
    position: emptyPosition(),
    fen: START_FEN,
    interactive: true,
    onMove: null,
    dragFromIndex: null
  };

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const squareEl = document.createElement("div");
      const index = rank * 8 + file;
      const isDark = (rank + file) % 2 === 0;
      squareEl.className = "board-square " + (isDark ? "dark" : "light");
      squareEl.dataset.square = FILES[file] + String(8 - rank);

      squareEl.addEventListener("dragover", (event) => {
        if (!state.interactive || state.dragFromIndex == null) return;
        event.preventDefault();
        squareEl.classList.add("drop-target");
      });

      squareEl.addEventListener("dragleave", () => {
        squareEl.classList.remove("drop-target");
      });

      squareEl.addEventListener("drop", (event) => {
        if (!state.interactive || state.dragFromIndex == null) return;
        event.preventDefault();

        const didMove = movePiece(state, state.dragFromIndex, index);
        clearDragClasses(state);
        state.dragFromIndex = null;

        if (didMove) renderSquares(state);
      });

      state.squares.push(squareEl);
      container.appendChild(squareEl);
    }
  }

  BOARD_STATE.set(container, state);
  return state;
}

function getBoardState(container) {
  return BOARD_STATE.get(container) || createBoardState(container);
}

export function renderBoard(container, fen, options = {}) {
  const state = getBoardState(container);

  state.interactive = options.interactive !== false;
  state.onMove = typeof options.onMove === "function" ? options.onMove : null;
  state.container.classList.toggle("interactive", state.interactive);

  const normalized = normalizeFen(fen);
  if (normalized !== state.fen) {
    try {
      state.position = parseFenPosition(normalized);
      state.fen = serializeFen(state.position);
    } catch {
      state.position = parseFenPosition(START_FEN);
      state.fen = START_FEN;
    }
  }

  renderSquares(state);
}
