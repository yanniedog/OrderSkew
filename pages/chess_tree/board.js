const PIECES = {
  p: "♟",
  r: "♜",
  n: "♞",
  b: "♝",
  q: "♛",
  k: "♚",
  P: "♙",
  R: "♖",
  N: "♘",
  B: "♗",
  Q: "♕",
  K: "♔"
};

function parseFenBoard(fen) {
  const board = [];
  const [layout] = (fen || "").split(" ");
  const rows = (layout || "").split("/");
  for (const row of rows) {
    const squares = [];
    for (const cell of row) {
      if (/\d/.test(cell)) {
        const count = Number(cell);
        for (let i = 0; i < count; i += 1) squares.push("");
      } else {
        squares.push(cell);
      }
    }
    board.push(squares);
  }
  return board;
}

export function renderBoard(container, fen) {
  container.innerHTML = "";
  const board = parseFenBoard(fen);
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = document.createElement("div");
      square.className = "board-square " + ((rank + file) % 2 === 0 ? "light" : "dark");
      const piece = board[rank]?.[file] || "";
      square.textContent = piece ? PIECES[piece] || "" : "";
      container.appendChild(square);
    }
  }
}
