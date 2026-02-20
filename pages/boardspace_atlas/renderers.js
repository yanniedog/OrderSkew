(function () {
  "use strict";

  function drawGrid(ctx, size, rows, cols, lineColor) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    for (let r = 0; r <= rows; r += 1) {
      const y = r * size / rows;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c += 1) {
      const x = c * size / cols;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
  }

  function drawTicTacToe(ctx, board, size) {
    ctx.fillStyle = "#08131f";
    ctx.fillRect(0, 0, size, size);
    drawGrid(ctx, size, 3, 3, "rgba(210, 232, 246, 0.35)");
    for (let i = 0; i < board.length; i += 1) {
      const value = board[i];
      if (!value) continue;
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = col * size / 3 + size / 6;
      const y = row * size / 3 + size / 6;
      ctx.font = "700 19px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = value === "X" ? "#f1b749" : "#6cb4ff";
      ctx.fillText(value, x, y + 1);
    }
  }

  function drawConnect4(ctx, board, size) {
    ctx.fillStyle = "#0d1d2a";
    ctx.fillRect(0, 0, size, size);
    const rows = 6;
    const cols = 7;
    const cellW = size / cols;
    const cellH = size / rows;
    ctx.fillStyle = "#12324f";
    ctx.fillRect(2, 2, size - 4, size - 4);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cx = c * cellW + cellW / 2;
        const cy = r * cellH + cellH / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(cellW, cellH) * 0.34, 0, Math.PI * 2);
        const v = board[r][c];
        if (v === 1) ctx.fillStyle = "#f1b749";
        else if (v === 2) ctx.fillStyle = "#ef7b63";
        else ctx.fillStyle = "#0f2033";
        ctx.fill();
        ctx.strokeStyle = "rgba(218, 232, 241, 0.25)";
        ctx.stroke();
      }
    }
  }

  function drawOthello(ctx, board, size) {
    ctx.fillStyle = "#12352a";
    ctx.fillRect(0, 0, size, size);
    drawGrid(ctx, size, 8, 8, "rgba(210, 232, 246, 0.28)");
    const cell = size / 8;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const v = board[r][c];
        if (!v) continue;
        const x = c * cell + cell / 2;
        const y = r * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = v === 1 ? "#111" : "#f4f4f4";
        ctx.fill();
        ctx.strokeStyle = v === 1 ? "#474747" : "#cccccc";
        ctx.stroke();
      }
    }
  }

  function drawGomoku(ctx, board, size) {
    ctx.fillStyle = "#2b2115";
    ctx.fillRect(0, 0, size, size);
    drawGrid(ctx, size, 5, 5, "rgba(246, 226, 196, 0.28)");
    const cell = size / 5;
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const v = board[r][c];
        if (!v) continue;
        const x = c * cell + cell / 2;
        const y = r * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = v === 1 ? "#101010" : "#ececec";
        ctx.fill();
      }
    }
  }

  function drawCheckers(ctx, board, size) {
    const cell = size / 8;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const dark = (r + c) % 2 === 1;
        ctx.fillStyle = dark ? "#385070" : "#d9e5ef";
        ctx.fillRect(c * cell, r * cell, cell, cell);
        const piece = board[r][c];
        if (!piece) continue;
        ctx.beginPath();
        ctx.arc(c * cell + cell / 2, r * cell + cell / 2, cell * 0.34, 0, Math.PI * 2);
        if (piece === "bm" || piece === "bk") ctx.fillStyle = "#f1b749";
        else ctx.fillStyle = "#67b0ff";
        ctx.fill();
        if (piece.endsWith("k")) {
          ctx.strokeStyle = "#fff6df";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
    }
  }

  function drawGo(ctx, board, size) {
    ctx.fillStyle = "#3a2b18";
    ctx.fillRect(0, 0, size, size);
    drawGrid(ctx, size, 5, 5, "rgba(255, 235, 201, 0.33)");
    const cell = size / 5;
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const v = board[r][c];
        if (!v) continue;
        const x = c * cell + cell / 2;
        const y = r * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = v === 1 ? "#111" : "#f8f8f8";
        ctx.fill();
        if (v === 2) {
          ctx.strokeStyle = "#d0d0d0";
          ctx.stroke();
        }
      }
    }
  }

  function drawHex(ctx, board, size) {
    ctx.fillStyle = "#18222c";
    ctx.fillRect(0, 0, size, size);
    const n = 5;
    const radius = size / (n * 1.95);
    const xGap = radius * 1.74;
    const yGap = radius * 1.5;
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        const cx = 10 + c * xGap + r * (xGap * 0.5);
        const cy = 10 + r * yGap;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const ang = (Math.PI / 180) * (60 * i + 30);
          const x = cx + radius * Math.cos(ang);
          const y = cy + radius * Math.sin(ang);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = "#223445";
        ctx.fill();
        ctx.strokeStyle = "rgba(212, 232, 245, 0.25)";
        ctx.stroke();
        const v = board[r][c];
        if (v) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius * 0.48, 0, Math.PI * 2);
          ctx.fillStyle = v === 1 ? "#f1b749" : "#5ec0a6";
          ctx.fill();
        }
      }
    }
  }

  function drawBreakthrough(ctx, board, size) {
    ctx.fillStyle = "#132330";
    ctx.fillRect(0, 0, size, size);
    drawGrid(ctx, size, 5, 5, "rgba(210, 232, 246, 0.3)");
    const cell = size / 5;
    for (let r = 0; r < 5; r += 1) {
      for (let c = 0; c < 5; c += 1) {
        const v = board[r][c];
        if (!v) continue;
        const x = c * cell + cell / 2;
        const y = r * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.31, 0, Math.PI * 2);
        ctx.fillStyle = v === 1 ? "#6cb4ff" : "#ef7b63";
        ctx.fill();
        ctx.strokeStyle = "rgba(8, 12, 16, 0.35)";
        ctx.stroke();
      }
    }
  }

  const NMM_COORDS = [
    [8, 8], [36, 8], [64, 8],
    [16, 16], [36, 16], [56, 16],
    [24, 24], [36, 24], [48, 24],
    [8, 36], [16, 36], [24, 36],
    [48, 36], [56, 36], [64, 36],
    [24, 48], [36, 48], [48, 48],
    [16, 56], [36, 56], [56, 56],
    [8, 64], [36, 64], [64, 64]
  ];

  const NMM_LINES = [
    [0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8],
    [9, 10], [10, 11], [12, 13], [13, 14], [15, 16], [16, 17],
    [18, 19], [19, 20], [21, 22], [22, 23],
    [0, 9], [9, 21], [3, 10], [10, 18], [6, 11], [11, 15],
    [1, 4], [4, 7], [16, 19], [19, 22],
    [8, 12], [12, 17], [5, 13], [13, 20], [2, 14], [14, 23]
  ];

  function drawNineMensMorris(ctx, board, size) {
    ctx.fillStyle = "#12202c";
    ctx.fillRect(0, 0, size, size);
    const scale = size / 72;
    ctx.strokeStyle = "rgba(208, 231, 246, 0.35)";
    ctx.lineWidth = 1.2;
    NMM_LINES.forEach(function (line) {
      const a = NMM_COORDS[line[0]];
      const b = NMM_COORDS[line[1]];
      ctx.beginPath();
      ctx.moveTo(a[0] * scale, a[1] * scale);
      ctx.lineTo(b[0] * scale, b[1] * scale);
      ctx.stroke();
    });
    for (let i = 0; i < 24; i += 1) {
      const p = NMM_COORDS[i];
      const x = p[0] * scale;
      const y = p[1] * scale;
      ctx.beginPath();
      ctx.arc(x, y, 3.4 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#1e3446";
      ctx.fill();
      ctx.strokeStyle = "rgba(220, 235, 245, 0.45)";
      ctx.stroke();
      if (board[i]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.6 * scale, 0, Math.PI * 2);
        ctx.fillStyle = board[i] === 1 ? "#6cb4ff" : "#f1b749";
        ctx.fill();
      }
    }
  }

  function drawQuoridor(ctx, board, size) {
    ctx.fillStyle = "#1b2a1f";
    ctx.fillRect(0, 0, size, size);
    const n = board.size;
    const pad = 6;
    const cell = (size - pad * 2) / n;
    ctx.strokeStyle = "rgba(224, 238, 227, 0.32)";
    for (let r = 0; r <= n; r += 1) {
      const y = pad + r * cell;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(size - pad, y);
      ctx.stroke();
    }
    for (let c = 0; c <= n; c += 1) {
      const x = pad + c * cell;
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, size - pad);
      ctx.stroke();
    }

    ctx.strokeStyle = "#ef7b63";
    ctx.lineWidth = 3;
    board.hWalls.forEach(function (w) {
      const y = pad + (w[0] + 1) * cell;
      const x = pad + w[1] * cell;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + cell * 2, y);
      ctx.stroke();
    });
    board.vWalls.forEach(function (w) {
      const x = pad + w[1] * cell;
      const y = pad + w[0] * cell;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + cell * 2);
      ctx.stroke();
    });
    ctx.lineWidth = 1;

    function drawPawn(pos, color) {
      const cx = pad + pos[1] * cell + cell / 2;
      const cy = pad + pos[0] * cell + cell / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    drawPawn(board.pawns.W, "#6cb4ff");
    drawPawn(board.pawns.B, "#f1b749");
  }

  function drawMiniBoard(canvas, game, board) {
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    if (game.gameId === "tictactoe") drawTicTacToe(ctx, board, size);
    else if (game.gameId === "connect4") drawConnect4(ctx, board, size);
    else if (game.gameId === "othello") drawOthello(ctx, board, size);
    else if (game.gameId === "gomoku") drawGomoku(ctx, board, size);
    else if (game.gameId === "checkers") drawCheckers(ctx, board, size);
    else if (game.gameId === "go") drawGo(ctx, board, size);
    else if (game.gameId === "hex") drawHex(ctx, board, size);
    else if (game.gameId === "breakthrough") drawBreakthrough(ctx, board, size);
    else if (game.gameId === "nmm") drawNineMensMorris(ctx, board, size);
    else if (game.gameId === "quoridor") drawQuoridor(ctx, board, size);
  }

  window.BoardSpaceAtlasRenderers = {
    drawMiniBoard: drawMiniBoard
  };
})();
