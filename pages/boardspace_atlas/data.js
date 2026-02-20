(function () {
  "use strict";

  /**
   * Internal front-end schema contract.
   * @typedef {Object} PositionRecord
   * @property {string} id
   * @property {string} label
   * @property {string} category
   * @property {any} board
   * @property {number[]} embedding
   * @property {[number, number]} pca2d
   * @property {number|null} symmetryGroup
   * @property {string=} notes
   *
   * @typedef {Object} GameRecord
   * @property {string} gameId
   * @property {string} gameName
   * @property {Object} boardSpec
   * @property {string[]} features
   * @property {PositionRecord[]} positions
   */

  const EMBED_NOISE = [
    [0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000, 0.000],
    [0.003, -0.002, 0.001, -0.001, 0.002, -0.002, 0.001, -0.001],
    [-0.002, 0.002, -0.001, 0.001, -0.002, 0.001, -0.001, 0.002],
    [0.001, 0.001, -0.002, 0.002, 0.000, -0.001, 0.002, -0.001],
    [-0.001, -0.001, 0.002, -0.002, 0.001, 0.002, -0.002, 0.001],
    [0.002, 0.000, -0.001, 0.000, -0.001, 0.002, 0.000, -0.002],
    [-0.002, 0.000, 0.001, 0.000, 0.001, -0.002, 0.000, 0.002],
    [0.001, -0.001, 0.000, 0.001, -0.001, 0.001, -0.001, 0.000],
    [-0.001, 0.001, 0.000, -0.001, 0.001, -0.001, 0.001, 0.000],
    [0.002, -0.001, 0.002, -0.001, 0.001, -0.002, 0.001, 0.001],
    [-0.002, 0.001, -0.002, 0.001, -0.001, 0.002, -0.001, -0.001],
    [0.001, 0.002, -0.001, -0.001, 0.002, -0.001, 0.000, 0.001]
  ];

  const PCA_NOISE = [
    [0.0, 0.0], [0.8, -0.5], [-0.7, 0.4], [0.5, 0.7],
    [-0.6, -0.6], [1.0, 0.2], [-0.9, -0.3], [0.3, -0.8],
    [-0.2, 0.9], [0.6, -0.2], [-0.5, 0.5], [0.2, 0.3]
  ];

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function tweakEmbedding(base, noiseIndex) {
    const noise = EMBED_NOISE[noiseIndex % EMBED_NOISE.length];
    return base.map(function (v, i) {
      return Number(clamp01(v + noise[i % noise.length]).toFixed(3));
    });
  }

  function tweakPca(base, noiseIndex) {
    const n = PCA_NOISE[noiseIndex % PCA_NOISE.length];
    return [Number((base[0] + n[0]).toFixed(2)), Number((base[1] + n[1]).toFixed(2))];
  }

  function matrix(rows, cols, fill) {
    return Array.from({ length: rows }, function () {
      return Array.from({ length: cols }, function () { return fill; });
    });
  }

  function mirrorMatrix(source) {
    return source.map(function (row) { return row.slice().reverse(); });
  }

  function rotateMatrixCW(source) {
    const rows = source.length;
    const cols = source[0].length;
    const out = matrix(cols, rows, 0);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        out[c][rows - 1 - r] = source[r][c];
      }
    }
    return out;
  }

  function parseGrid(rows, mapping) {
    return rows.map(function (row) {
      return row.split("").map(function (ch) { return mapping[ch]; });
    });
  }

  function tttBoard(rows) {
    return rows.join("").split("").map(function (ch) { return ch === "." ? "" : ch; });
  }

  function gridFromCoords(size, black, white) {
    const out = matrix(size, size, 0);
    black.forEach(function (c) {
      out[c[0]][c[1]] = 1;
    });
    white.forEach(function (c) {
      out[c[0]][c[1]] = 2;
    });
    return out;
  }

  function checkersBoard(spec) {
    const out = matrix(8, 8, "");
    spec.bm.forEach(function (c) { out[c[0]][c[1]] = "bm"; });
    spec.bk.forEach(function (c) { out[c[0]][c[1]] = "bk"; });
    spec.wm.forEach(function (c) { out[c[0]][c[1]] = "wm"; });
    spec.wk.forEach(function (c) { out[c[0]][c[1]] = "wk"; });
    return out;
  }

  function mirrorCheckers(board) {
    return board.map(function (row) { return row.slice().reverse(); });
  }

  function nmmState(white, black) {
    const out = Array.from({ length: 24 }, function () { return 0; });
    white.forEach(function (idx) { out[idx] = 1; });
    black.forEach(function (idx) { out[idx] = 2; });
    return out;
  }

  const NMM_MIRROR_INDEX = [2, 1, 0, 5, 4, 3, 8, 7, 6, 14, 13, 12, 11, 10, 9, 17, 16, 15, 20, 19, 18, 23, 22, 21];

  function mirrorNmm(state) {
    const out = Array.from({ length: 24 }, function () { return 0; });
    for (let i = 0; i < 24; i += 1) {
      out[NMM_MIRROR_INDEX[i]] = state[i];
    }
    return out;
  }

  function qBoard(whitePawn, blackPawn, hWalls, vWalls) {
    return {
      size: 5,
      pawns: {
        W: whitePawn,
        B: blackPawn
      },
      hWalls: hWalls.slice(),
      vWalls: vWalls.slice()
    };
  }

  function mirrorQuoridor(board) {
    return {
      size: board.size,
      pawns: {
        W: [board.pawns.W[0], board.size - 1 - board.pawns.W[1]],
        B: [board.pawns.B[0], board.size - 1 - board.pawns.B[1]]
      },
      hWalls: board.hWalls.map(function (w) { return [w[0], (board.size - 2) - w[1]]; }),
      vWalls: board.vWalls.map(function (w) { return [w[0], (board.size - 1) - w[1]]; })
    };
  }

  function makePos(id, label, category, board, embedding, pca2d, symmetryGroup, notes) {
    return {
      id: id,
      label: label,
      category: category,
      board: board,
      embedding: embedding,
      pca2d: pca2d,
      symmetryGroup: typeof symmetryGroup === "number" ? symmetryGroup : null,
      notes: notes || ""
    };
  }

  function buildTicTacToe() {
    const features = ["center_control", "line_pressure", "fork_potential", "defense", "initiative", "terminality"];
    const cornerBase = tttBoard(["X..", "...", "..."]);
    const cornerMirror = tttBoard(["..X", "...", "..."]);
    const cornerRot = tttBoard(["...", "...", "..X"]);
    const edgeBase = tttBoard([".X.", "...", "..."]);
    const edgeMirror = tttBoard(["...", "X..", "..."]);
    const forkA = tttBoard(["X..", ".X.", "O.O"]);
    const forkB = tttBoard(["..X", ".X.", "O.O"]);
    const oppCornerA = tttBoard(["X..", ".O.", "..X"]);
    const oppCornerB = tttBoard(["..X", ".O.", "X.."]);

    return {
      gameId: "tictactoe",
      gameName: "Tic-Tac-Toe",
      boardSpec: { type: "grid", rows: 3, cols: 3 },
      features: features,
      positions: [
        makePos("ttt-01", "Center opening", "opening", tttBoard(["...", ".X.", "..."]), tweakEmbedding([0.88, 0.42, 0.36, 0.52, 0.61, 0.10], 0), tweakPca([5.2, 2.9], 0), null, "X claims the center."),
        makePos("ttt-02", "Corner opening", "opening", cornerBase, tweakEmbedding([0.69, 0.35, 0.44, 0.41, 0.55, 0.08], 1), tweakPca([-3.0, 8.2], 1), 1, "Corner pressure setup."),
        makePos("ttt-03", "Corner opening mirror", "opening", cornerMirror, tweakEmbedding([0.69, 0.35, 0.44, 0.41, 0.55, 0.08], 2), tweakPca([-3.0, 8.2], 2), 1, "Horizontal reflection of corner setup."),
        makePos("ttt-04", "Corner opening rotate", "opening", cornerRot, tweakEmbedding([0.69, 0.35, 0.44, 0.41, 0.55, 0.08], 3), tweakPca([-3.0, 8.2], 3), 1, "Rotated corner setup."),
        makePos("ttt-05", "Edge opening", "opening", edgeBase, tweakEmbedding([0.53, 0.28, 0.40, 0.50, 0.47, 0.07], 4), tweakPca([-8.0, 2.0], 4), 2, "Less direct center pressure."),
        makePos("ttt-06", "Edge opening mirror", "opening", edgeMirror, tweakEmbedding([0.53, 0.28, 0.40, 0.50, 0.47, 0.07], 5), tweakPca([-8.0, 2.0], 5), 2, "Mirror-equivalent edge start."),
        makePos("ttt-07", "Fork threat A", "threat", forkA, tweakEmbedding([0.76, 0.71, 0.91, 0.58, 0.73, 0.43], 6), tweakPca([9.0, 9.0], 6), 3, "Double-threat scaffold."),
        makePos("ttt-08", "Fork threat B", "threat", forkB, tweakEmbedding([0.76, 0.71, 0.91, 0.58, 0.73, 0.43], 7), tweakPca([9.0, 9.0], 7), 3, "Mirror fork profile."),
        makePos("ttt-09", "Opposite corners", "pressure", oppCornerA, tweakEmbedding([0.68, 0.67, 0.74, 0.45, 0.62, 0.40], 8), tweakPca([4.1, 7.0], 8), 4, "Diagonal pressure."),
        makePos("ttt-10", "Opposite corners rotate", "pressure", oppCornerB, tweakEmbedding([0.68, 0.67, 0.74, 0.45, 0.62, 0.40], 9), tweakPca([4.1, 7.0], 9), 4, "Equivalent diagonal pressure."),
        makePos("ttt-11", "Block immediate loss", "defense", tttBoard(["XO.", ".OX", "..X"]), tweakEmbedding([0.62, 0.64, 0.35, 0.79, 0.46, 0.33], 10), tweakPca([7.2, -2.0], 10), null, "Defensive resource move."),
        makePos("ttt-12", "Full draw", "endgame", tttBoard(["XOX", "XOO", "OXX"]), tweakEmbedding([0.51, 0.50, 0.49, 0.55, 0.48, 0.97], 11), tweakPca([0.0, -7.0], 11), null, "Terminal draw state.")
      ]
    };
  }

  function buildConnect4() {
    const features = ["center_control", "vertical_threat", "horizontal_threat", "mobility", "initiative", "finish_pressure"];
    const boards = {
      a: parseGrid([".......", ".......", ".......", ".......", ".......", "Y......"], { ".": 0, "Y": 1, "R": 2 }),
      b: parseGrid([".......", ".......", ".......", ".......", "...R...", "..YY..."], { ".": 0, "Y": 1, "R": 2 }),
      c: parseGrid([".......", ".......", ".......", "..R....", ".YYR...", "RYYR..."], { ".": 0, "Y": 1, "R": 2 }),
      d: parseGrid([".......", ".......", ".......", "..Y....", "..YR...", ".RYYR.."], { ".": 0, "Y": 1, "R": 2 }),
      e: parseGrid([".......", ".......", ".......", "..Y....", ".RYR...", "RYYYR.."], { ".": 0, "Y": 1, "R": 2 }),
      f: parseGrid([".......", ".......", ".......", "...R...", "..YYR..", "RYYRR.."], { ".": 0, "Y": 1, "R": 2 })
    };

    return {
      gameId: "connect4",
      gameName: "Connect 4",
      boardSpec: { type: "grid", rows: 6, cols: 7, gravity: true, symmetry: "mirror_lr" },
      features: features,
      positions: [
        makePos("c4-01", "Edge opener", "opening", boards.a, tweakEmbedding([0.24, 0.18, 0.32, 0.61, 0.44, 0.08], 0), tweakPca([-11.0, 5.4], 0), 11, "Left edge opening."),
        makePos("c4-02", "Edge opener mirror", "opening", mirrorMatrix(boards.a), tweakEmbedding([0.24, 0.18, 0.32, 0.61, 0.44, 0.08], 1), tweakPca([-11.0, 5.4], 1), 11, "Right edge mirror equivalent."),
        makePos("c4-03", "Center lane setup", "opening", boards.b, tweakEmbedding([0.76, 0.43, 0.36, 0.72, 0.58, 0.22], 2), tweakPca([2.0, 9.8], 2), 12, "Early center stacking."),
        makePos("c4-04", "Center lane setup mirror", "opening", mirrorMatrix(boards.b), tweakEmbedding([0.76, 0.43, 0.36, 0.72, 0.58, 0.22], 3), tweakPca([2.0, 9.8], 3), 12, "Mirror of center lane setup."),
        makePos("c4-05", "Left wedge pressure", "pressure", boards.c, tweakEmbedding([0.48, 0.63, 0.75, 0.52, 0.61, 0.41], 4), tweakPca([-3.5, 2.5], 4), 13, "Horizontal plus diagonal pressure."),
        makePos("c4-06", "Right wedge pressure", "pressure", mirrorMatrix(boards.c), tweakEmbedding([0.48, 0.63, 0.75, 0.52, 0.61, 0.41], 5), tweakPca([-3.5, 2.5], 5), 13, "Mirror wedge pressure."),
        makePos("c4-07", "Two-way threat", "threat", boards.d, tweakEmbedding([0.71, 0.66, 0.72, 0.49, 0.69, 0.53], 6), tweakPca([7.8, 4.4], 6), 14, "Fork-like threat profile."),
        makePos("c4-08", "Two-way threat mirror", "threat", mirrorMatrix(boards.d), tweakEmbedding([0.71, 0.66, 0.72, 0.49, 0.69, 0.53], 7), tweakPca([7.8, 4.4], 7), 14, "Mirror fork-like profile."),
        makePos("c4-09", "Near connect-four", "threat", boards.e, tweakEmbedding([0.67, 0.74, 0.88, 0.35, 0.78, 0.70], 8), tweakPca([12.4, -1.5], 8), 15, "Immediate tactical pressure."),
        makePos("c4-10", "Near connect-four mirror", "threat", mirrorMatrix(boards.e), tweakEmbedding([0.67, 0.74, 0.88, 0.35, 0.78, 0.70], 9), tweakPca([12.4, -1.5], 9), 15, "Mirror immediate pressure."),
        makePos("c4-11", "Late tactical race", "midgame", boards.f, tweakEmbedding([0.55, 0.70, 0.66, 0.30, 0.57, 0.61], 10), tweakPca([4.3, -8.3], 10), 16, "Balanced but sharp race."),
        makePos("c4-12", "Late tactical race mirror", "midgame", mirrorMatrix(boards.f), tweakEmbedding([0.55, 0.70, 0.66, 0.30, 0.57, 0.61], 11), tweakPca([4.3, -8.3], 11), 16, "Mirror tactical race.")
      ]
    };
  }

  function buildOthello() {
    const features = ["corner_stability", "mobility", "frontier_risk", "parity_control", "edge_influence", "material_delta"];
    const start = parseGrid([
      "........",
      "........",
      "........",
      "...WB...",
      "...BW...",
      "........",
      "........",
      "........"
    ], { ".": 0, "B": 1, "W": 2 });
    const firstMove = parseGrid([
      "........",
      "........",
      "........",
      "..BBB...",
      "...BW...",
      "........",
      "........",
      "........"
    ], { ".": 0, "B": 1, "W": 2 });
    const cornerBase = parseGrid([
      "BBBB....",
      "BWWB....",
      "BWBB....",
      "BBBWB...",
      "..WWB...",
      "...WW...",
      "........",
      "........"
    ], { ".": 0, "B": 1, "W": 2 });
    const edgeBase = parseGrid([
      "........",
      ".WWW....",
      ".WBB....",
      ".WBWB...",
      ".WBBB...",
      ".WWBB...",
      "..B.....",
      "........"
    ], { ".": 0, "B": 1, "W": 2 });
    const mobilityRace = parseGrid([
      "..BBW...",
      ".BBBWW..",
      ".BBWBW..",
      "..BWWW..",
      "...BWW..",
      "...BBB..",
      "........",
      "........"
    ], { ".": 0, "B": 1, "W": 2 });
    const parityLock = parseGrid([
      "BBWWBBBB",
      "BWWWWBBB",
      "BBWBWBBB",
      "BWBWWBBB",
      "BBWBBBBB",
      "BBBWBBBB",
      "BBBBBBBB",
      "BBBBWBBB"
    ], { ".": 0, "B": 1, "W": 2 });
    const endgame = parseGrid([
      "BWBWBWBW",
      "WBBBWBWB",
      "BWBBBWBW",
      "WBWBBBWB",
      "BWBWBBBW",
      "WBWBWBBB",
      "BWWWBWBB",
      "WBBBWBWB"
    ], { ".": 0, "B": 1, "W": 2 });

    return {
      gameId: "othello",
      gameName: "Othello / Reversi",
      boardSpec: { type: "grid", rows: 8, cols: 8 },
      features: features,
      positions: [
        makePos("oth-01", "Start position", "opening", start, tweakEmbedding([0.50, 0.50, 0.50, 0.50, 0.50, 0.50], 0), tweakPca([-8.8, -6.8], 0), null, "Neutral start."),
        makePos("oth-02", "First move cluster A", "opening", firstMove, tweakEmbedding([0.57, 0.62, 0.47, 0.44, 0.53, 0.56], 1), tweakPca([-1.4, 10.0], 1), 21, "One of the four equivalent first moves."),
        makePos("oth-03", "First move cluster B", "opening", rotateMatrixCW(firstMove), tweakEmbedding([0.57, 0.62, 0.47, 0.44, 0.53, 0.56], 2), tweakPca([-1.4, 10.0], 2), 21, "90 degree rotation equivalent."),
        makePos("oth-04", "First move cluster C", "opening", rotateMatrixCW(rotateMatrixCW(firstMove)), tweakEmbedding([0.57, 0.62, 0.47, 0.44, 0.53, 0.56], 3), tweakPca([-1.4, 10.0], 3), 21, "180 degree rotation equivalent."),
        makePos("oth-05", "First move cluster D", "opening", rotateMatrixCW(rotateMatrixCW(rotateMatrixCW(firstMove))), tweakEmbedding([0.57, 0.62, 0.47, 0.44, 0.53, 0.56], 4), tweakPca([-1.4, 10.0], 4), 21, "270 degree rotation equivalent."),
        makePos("oth-06", "Corner secure A", "pressure", cornerBase, tweakEmbedding([0.91, 0.42, 0.39, 0.70, 0.88, 0.72], 5), tweakPca([12.8, 5.9], 5), 22, "Corner plus edge stability."),
        makePos("oth-07", "Corner secure B", "pressure", rotateMatrixCW(rotateMatrixCW(cornerBase)), tweakEmbedding([0.91, 0.42, 0.39, 0.70, 0.88, 0.72], 6), tweakPca([12.8, 5.9], 6), 22, "Rotated corner profile."),
        makePos("oth-08", "Edge squeeze A", "midgame", edgeBase, tweakEmbedding([0.73, 0.54, 0.62, 0.66, 0.79, 0.64], 7), tweakPca([4.4, 1.6], 7), 23, "Edge squeeze profile."),
        makePos("oth-09", "Edge squeeze B", "midgame", mirrorMatrix(edgeBase), tweakEmbedding([0.73, 0.54, 0.62, 0.66, 0.79, 0.64], 8), tweakPca([4.4, 1.6], 8), 23, "Mirror edge squeeze."),
        makePos("oth-10", "Mobility race", "midgame", mobilityRace, tweakEmbedding([0.58, 0.81, 0.46, 0.39, 0.57, 0.63], 9), tweakPca([-4.2, 2.4], 9), null, "Move-count leverage over stability."),
        makePos("oth-11", "Parity lock", "endgame", parityLock, tweakEmbedding([0.84, 0.36, 0.58, 0.92, 0.82, 0.88], 10), tweakPca([9.2, -7.8], 10), null, "Parity and corner dominance."),
        makePos("oth-12", "Dense endgame", "endgame", endgame, tweakEmbedding([0.66, 0.29, 0.70, 0.73, 0.64, 0.97], 11), tweakPca([0.6, -10.2], 11), null, "Near-terminal packed board.")
      ]
    };
  }

  function buildGomoku() {
    const features = ["center_control", "open_threes", "open_fours", "blocking", "initiative", "terminal_pressure"];
    const openThree = gridFromCoords(5, [[2, 1], [2, 2], [2, 3]], [[1, 2], [3, 2]]);
    const fourThreat = gridFromCoords(5, [[1, 0], [1, 1], [1, 2], [1, 3]], [[2, 2], [3, 3]]);
    const cornerNet = gridFromCoords(5, [[0, 0], [1, 1], [2, 2]], [[0, 2], [2, 0]]);

    return {
      gameId: "gomoku",
      gameName: "Gomoku (5x5)",
      boardSpec: { type: "grid", rows: 5, cols: 5 },
      features: features,
      positions: [
        makePos("gom-01", "Empty board", "opening", matrix(5, 5, 0), tweakEmbedding([0.20, 0.10, 0.05, 0.40, 0.35, 0.05], 0), tweakPca([-10.3, -8.2], 0), null, "No commitments yet."),
        makePos("gom-02", "Center anchor", "opening", gridFromCoords(5, [[2, 2]], [[1, 1]]), tweakEmbedding([0.84, 0.24, 0.10, 0.39, 0.59, 0.11], 1), tweakPca([-3.0, 9.1], 1), null, "Center control start."),
        makePos("gom-03", "Open three A", "pressure", openThree, tweakEmbedding([0.72, 0.88, 0.35, 0.44, 0.72, 0.51], 2), tweakPca([4.5, 8.0], 2), 31, "Primary open three shape."),
        makePos("gom-04", "Open three B", "pressure", rotateMatrixCW(openThree), tweakEmbedding([0.72, 0.88, 0.35, 0.44, 0.72, 0.51], 3), tweakPca([4.5, 8.0], 3), 31, "Rotated open three."),
        makePos("gom-05", "Open three C", "pressure", mirrorMatrix(openThree), tweakEmbedding([0.72, 0.88, 0.35, 0.44, 0.72, 0.51], 4), tweakPca([4.5, 8.0], 4), 31, "Mirror open three."),
        makePos("gom-06", "Four threat A", "threat", fourThreat, tweakEmbedding([0.62, 0.58, 0.93, 0.41, 0.80, 0.79], 5), tweakPca([11.2, 2.3], 5), 32, "Immediate winning pressure."),
        makePos("gom-07", "Four threat B", "threat", mirrorMatrix(fourThreat), tweakEmbedding([0.62, 0.58, 0.93, 0.41, 0.80, 0.79], 6), tweakPca([11.2, 2.3], 6), 32, "Mirror winning pressure."),
        makePos("gom-08", "Split influence", "midgame", gridFromCoords(5, [[1, 1], [2, 2], [3, 3]], [[1, 3], [3, 1]]), tweakEmbedding([0.54, 0.46, 0.45, 0.56, 0.61, 0.36], 7), tweakPca([0.7, 2.0], 7), null, "Competing diagonals."),
        makePos("gom-09", "Defensive block", "defense", gridFromCoords(5, [[2, 0], [2, 1], [2, 3]], [[2, 2], [3, 2], [1, 2]]), tweakEmbedding([0.48, 0.32, 0.51, 0.83, 0.42, 0.30], 8), tweakPca([-2.8, -0.9], 8), null, "Central block resources."),
        makePos("gom-10", "Corner framework A", "midgame", cornerNet, tweakEmbedding([0.55, 0.41, 0.43, 0.58, 0.46, 0.32], 9), tweakPca([-8.4, 4.3], 9), 33, "Corner-oriented framework."),
        makePos("gom-11", "Corner framework B", "midgame", mirrorMatrix(cornerNet), tweakEmbedding([0.55, 0.41, 0.43, 0.58, 0.46, 0.32], 10), tweakPca([-8.4, 4.3], 10), 33, "Mirror corner framework."),
        makePos("gom-12", "Near five", "endgame", gridFromCoords(5, [[4, 0], [4, 1], [4, 2], [4, 3]], [[3, 1], [3, 2]]), tweakEmbedding([0.41, 0.70, 0.95, 0.33, 0.74, 0.94], 11), tweakPca([12.0, -7.2], 11), null, "One move from terminal win.")
      ]
    };
  }

  function buildCheckers() {
    const features = ["material", "king_safety", "promotion_pressure", "center_control", "mobility", "capture_threat"];
    const opening = checkersBoard({
      bm: [[0, 1], [0, 3], [0, 5], [0, 7], [1, 0], [1, 2], [1, 4], [1, 6], [2, 1], [2, 3]],
      bk: [],
      wm: [[5, 0], [5, 2], [5, 4], [5, 6], [6, 1], [6, 3], [6, 5], [6, 7], [7, 0], [7, 2]],
      wk: []
    });
    const wedgeA = checkersBoard({
      bm: [[1, 2], [2, 3], [3, 4], [2, 1], [4, 3]],
      bk: [[0, 5]],
      wm: [[6, 1], [5, 2], [4, 1], [5, 4], [6, 5]],
      wk: [[7, 6]]
    });
    const exchangeTrap = checkersBoard({
      bm: [[2, 1], [2, 3], [3, 2], [4, 5]],
      bk: [[0, 7]],
      wm: [[5, 2], [5, 4], [4, 3], [3, 6]],
      wk: [[7, 0]]
    });

    return {
      gameId: "checkers",
      gameName: "Checkers",
      boardSpec: { type: "grid", rows: 8, cols: 8, darkSquaresOnly: true },
      features: features,
      positions: [
        makePos("chk-01", "Compact opening", "opening", opening, tweakEmbedding([0.50, 0.55, 0.20, 0.56, 0.62, 0.31], 0), tweakPca([-9.6, -7.9], 0), null, "Balanced material and mobility."),
        makePos("chk-02", "Wedge A", "pressure", wedgeA, tweakEmbedding([0.57, 0.58, 0.41, 0.72, 0.50, 0.60], 1), tweakPca([2.2, 8.8], 1), 41, "Advanced wedge structure."),
        makePos("chk-03", "Wedge B mirror", "pressure", mirrorCheckers(wedgeA), tweakEmbedding([0.57, 0.58, 0.41, 0.72, 0.50, 0.60], 2), tweakPca([2.2, 8.8], 2), 41, "Mirror wedge structure."),
        makePos("chk-04", "Promotion race", "midgame", checkersBoard({ bm: [[1, 2], [2, 5], [3, 4]], bk: [], wm: [[6, 1], [5, 0], [4, 3]], wk: [[7, 6]] }), tweakEmbedding([0.45, 0.44, 0.84, 0.40, 0.57, 0.35], 3), tweakPca([-1.2, 5.1], 3), null, "Forward race to kings."),
        makePos("chk-05", "King hunt", "threat", checkersBoard({ bm: [[2, 3], [3, 4], [4, 5]], bk: [[1, 6]], wm: [[5, 2], [6, 3], [4, 1]], wk: [[7, 0], [7, 4]] }), tweakEmbedding([0.60, 0.68, 0.55, 0.49, 0.45, 0.76], 4), tweakPca([8.2, 4.4], 4), null, "King targeting sequence."),
        makePos("chk-06", "Center lock", "defense", checkersBoard({ bm: [[2, 1], [2, 3], [3, 2], [3, 4]], bk: [], wm: [[4, 1], [4, 3], [5, 2], [5, 4]], wk: [] }), tweakEmbedding([0.49, 0.52, 0.22, 0.87, 0.27, 0.46], 5), tweakPca([-4.8, -0.6], 5), null, "Blocked center lanes."),
        makePos("chk-07", "Breakthrough lane", "threat", checkersBoard({ bm: [[1, 0], [2, 1], [3, 2], [2, 5]], bk: [[0, 7]], wm: [[6, 3], [5, 4], [4, 5]], wk: [[7, 6]] }), tweakEmbedding([0.54, 0.40, 0.88, 0.37, 0.64, 0.70], 6), tweakPca([11.5, -1.3], 6), null, "Open path to promotion."),
        makePos("chk-08", "Defensive wall", "defense", checkersBoard({ bm: [[2, 1], [2, 3], [2, 5], [3, 4]], bk: [], wm: [[5, 0], [5, 2], [5, 4], [5, 6]], wk: [[7, 0]] }), tweakEmbedding([0.48, 0.57, 0.28, 0.74, 0.41, 0.42], 7), tweakPca([-6.3, 2.8], 7), null, "Solid back-rank shape."),
        makePos("chk-09", "Exchange trap A", "threat", exchangeTrap, tweakEmbedding([0.63, 0.61, 0.47, 0.45, 0.39, 0.83], 8), tweakPca([6.1, -4.5], 8), 42, "Forced exchange line."),
        makePos("chk-10", "Exchange trap B", "threat", mirrorCheckers(exchangeTrap), tweakEmbedding([0.63, 0.61, 0.47, 0.45, 0.39, 0.83], 9), tweakPca([6.1, -4.5], 9), 42, "Mirror forced exchange."),
        makePos("chk-11", "King endgame", "endgame", checkersBoard({ bm: [[3, 2]], bk: [[1, 4], [2, 7]], wm: [[5, 0]], wk: [[6, 3], [7, 6]] }), tweakEmbedding([0.58, 0.79, 0.52, 0.41, 0.33, 0.55], 10), tweakPca([1.0, -9.7], 10), null, "King mobility dominates."),
        makePos("chk-12", "Promotion in one", "endgame", checkersBoard({ bm: [[6, 1], [4, 3]], bk: [], wm: [[1, 6], [2, 5]], wk: [[0, 1]] }), tweakEmbedding([0.52, 0.50, 0.95, 0.33, 0.53, 0.62], 11), tweakPca([10.5, -8.1], 11), null, "One-step king conversion.")
      ]
    };
  }

  function buildGo() {
    const features = ["center_influence", "territory_potential", "group_safety", "cutting_power", "initiative", "endgame_value"];
    const josekiBase = gridFromCoords(5, [[1, 1], [1, 2], [2, 1]], [[2, 2], [3, 2]]);
    const moyoBase = gridFromCoords(5, [[0, 1], [1, 1], [1, 2], [2, 2]], [[3, 3], [3, 4], [4, 3]]);

    return {
      gameId: "go",
      gameName: "Go (5x5)",
      boardSpec: { type: "grid", rows: 5, cols: 5 },
      features: features,
      positions: [
        makePos("go-01", "Empty board", "opening", matrix(5, 5, 0), tweakEmbedding([0.12, 0.10, 0.16, 0.10, 0.45, 0.06], 0), tweakPca([-11.2, -9.4], 0), null, "No stones placed."),
        makePos("go-02", "Center probe", "opening", gridFromCoords(5, [[2, 2]], []), tweakEmbedding([0.86, 0.38, 0.24, 0.22, 0.60, 0.10], 1), tweakPca([-4.0, 8.4], 1), null, "Center influence anchor."),
        makePos("go-03", "Joseki shape A", "midgame", josekiBase, tweakEmbedding([0.64, 0.57, 0.70, 0.52, 0.63, 0.31], 2), tweakPca([2.2, 8.8], 2), 51, "Balanced shape with local life."),
        makePos("go-04", "Joseki shape B", "midgame", rotateMatrixCW(josekiBase), tweakEmbedding([0.64, 0.57, 0.70, 0.52, 0.63, 0.31], 3), tweakPca([2.2, 8.8], 3), 51, "Rotated equivalent local pattern."),
        makePos("go-05", "Joseki shape C", "midgame", mirrorMatrix(josekiBase), tweakEmbedding([0.64, 0.57, 0.70, 0.52, 0.63, 0.31], 4), tweakPca([2.2, 8.8], 4), 51, "Mirrored equivalent local pattern."),
        makePos("go-06", "Moyo framework A", "pressure", moyoBase, tweakEmbedding([0.71, 0.84, 0.55, 0.33, 0.58, 0.44], 5), tweakPca([8.7, 3.5], 5), 52, "Large framework potential."),
        makePos("go-07", "Moyo framework B", "pressure", mirrorMatrix(moyoBase), tweakEmbedding([0.71, 0.84, 0.55, 0.33, 0.58, 0.44], 6), tweakPca([8.7, 3.5], 6), 52, "Mirror moyo framework."),
        makePos("go-08", "Cutting battle", "threat", gridFromCoords(5, [[1, 1], [1, 3], [2, 2], [3, 1]], [[1, 2], [2, 1], [2, 3], [3, 2]]), tweakEmbedding([0.57, 0.43, 0.40, 0.88, 0.66, 0.39], 7), tweakPca([5.4, -0.3], 7), null, "Mutual cutting points."),
        makePos("go-09", "Life and death", "threat", gridFromCoords(5, [[0, 0], [0, 1], [1, 0], [1, 2], [2, 1]], [[0, 2], [1, 1], [2, 0], [2, 2]]), tweakEmbedding([0.44, 0.48, 0.90, 0.62, 0.52, 0.61], 8), tweakPca([10.8, -2.1], 8), null, "Compact capturing race."),
        makePos("go-10", "Endgame sente", "endgame", gridFromCoords(5, [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0], [4, 4]], [[4, 2], [4, 3], [3, 4], [2, 4], [4, 1]]), tweakEmbedding([0.31, 0.66, 0.61, 0.20, 0.88, 0.74], 9), tweakPca([-0.6, -7.4], 9), null, "Big endgame points with sente."),
        makePos("go-11", "Territory lock", "endgame", gridFromCoords(5, [[0, 0], [0, 1], [1, 0], [4, 4], [4, 3], [3, 4]], [[0, 4], [0, 3], [1, 4], [4, 0], [4, 1], [3, 0]]), tweakEmbedding([0.48, 0.91, 0.63, 0.18, 0.41, 0.86], 10), tweakPca([-6.2, -5.8], 10), null, "Large secure corners."),
        makePos("go-12", "Final count shape", "endgame", gridFromCoords(5, [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [4, 2], [4, 3]], [[0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 0], [4, 1]]), tweakEmbedding([0.40, 0.79, 0.72, 0.17, 0.33, 0.97], 11), tweakPca([1.8, -10.4], 11), null, "Late counting position.")
      ]
    };
  }

  function buildHex() {
    const features = ["connection_progress", "bridge_stability", "blocking", "path_diversity", "initiative", "race_advantage"];
    const bridgeA = gridFromCoords(5, [[0, 1], [1, 2], [2, 3]], [[1, 1], [2, 2], [3, 3]]);
    const chainA = gridFromCoords(5, [[1, 0], [2, 1], [3, 2], [4, 3]], [[0, 2], [1, 3], [2, 4]]);

    return {
      gameId: "hex",
      gameName: "Hex (5x5)",
      boardSpec: { type: "hex", rows: 5, cols: 5 },
      features: features,
      positions: [
        makePos("hex-01", "Empty board", "opening", matrix(5, 5, 0), tweakEmbedding([0.10, 0.11, 0.09, 0.20, 0.45, 0.06], 0), tweakPca([-10.6, -9.0], 0), null, "No stones."),
        makePos("hex-02", "Center claim", "opening", gridFromCoords(5, [[2, 2]], []), tweakEmbedding([0.75, 0.27, 0.18, 0.40, 0.62, 0.11], 1), tweakPca([-4.1, 8.8], 1), null, "Central bridge potential."),
        makePos("hex-03", "Bridge net A", "pressure", bridgeA, tweakEmbedding([0.66, 0.82, 0.42, 0.54, 0.58, 0.47], 2), tweakPca([2.6, 8.0], 2), 61, "Bridge-building pattern."),
        makePos("hex-04", "Bridge net B", "pressure", mirrorMatrix(bridgeA), tweakEmbedding([0.66, 0.82, 0.42, 0.54, 0.58, 0.47], 3), tweakPca([2.6, 8.0], 3), 61, "Mirror bridge pattern."),
        makePos("hex-05", "Bridge net C", "pressure", rotateMatrixCW(rotateMatrixCW(bridgeA)), tweakEmbedding([0.66, 0.82, 0.42, 0.54, 0.58, 0.47], 4), tweakPca([2.6, 8.0], 4), 61, "Rotated bridge pattern."),
        makePos("hex-06", "Chain attack A", "threat", chainA, tweakEmbedding([0.83, 0.56, 0.72, 0.61, 0.71, 0.76], 5), tweakPca([10.3, 4.2], 5), 62, "Long attacking chain."),
        makePos("hex-07", "Chain attack B", "threat", mirrorMatrix(chainA), tweakEmbedding([0.83, 0.56, 0.72, 0.61, 0.71, 0.76], 6), tweakPca([10.3, 4.2], 6), 62, "Mirror long chain."),
        makePos("hex-08", "Counter wall", "defense", gridFromCoords(5, [[1, 1], [2, 2], [3, 3]], [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]]), tweakEmbedding([0.41, 0.36, 0.88, 0.29, 0.53, 0.40], 7), tweakPca([-1.7, 0.3], 7), null, "Blocking wall response."),
        makePos("hex-09", "Dual route", "midgame", gridFromCoords(5, [[0, 0], [1, 1], [2, 2], [3, 1], [4, 0]], [[0, 4], [1, 3], [2, 3], [3, 4]]), tweakEmbedding([0.62, 0.71, 0.41, 0.89, 0.52, 0.57], 8), tweakPca([5.5, -0.8], 8), null, "Multiple route pressure."),
        makePos("hex-10", "Near connect A", "endgame", gridFromCoords(5, [[0, 1], [1, 1], [2, 1], [3, 2], [4, 2]], [[0, 2], [1, 2], [2, 2], [3, 1], [4, 1]]), tweakEmbedding([0.74, 0.49, 0.70, 0.45, 0.67, 0.91], 9), tweakPca([11.8, -2.9], 9), 63, "One move from edge-to-edge connection."),
        makePos("hex-11", "Near connect B", "endgame", mirrorMatrix(gridFromCoords(5, [[0, 1], [1, 1], [2, 1], [3, 2], [4, 2]], [[0, 2], [1, 2], [2, 2], [3, 1], [4, 1]])), tweakEmbedding([0.74, 0.49, 0.70, 0.45, 0.67, 0.91], 10), tweakPca([11.8, -2.9], 10), 63, "Mirror near-connection."),
        makePos("hex-12", "Race finish", "endgame", gridFromCoords(5, [[0, 0], [1, 0], [2, 1], [3, 2], [4, 3]], [[0, 4], [1, 3], [2, 3], [3, 4], [4, 4]]), tweakEmbedding([0.69, 0.47, 0.63, 0.50, 0.80, 0.97], 11), tweakPca([2.4, -10.1], 11), null, "Mutual final race.")
      ]
    };
  }

  function buildBreakthrough() {
    const features = ["pawn_structure", "promotion_race", "capture_lanes", "center_control", "tempo", "kingless_tactics"];
    const start = parseGrid(["22222", "22222", "00000", "11111", "11111"], { "0": 0, "1": 1, "2": 2 });
    const spear = parseGrid(["22022", "20222", "00100", "11011", "11111"], { "0": 0, "1": 1, "2": 2 });
    const lane = parseGrid(["22222", "22022", "00100", "11011", "11101"], { "0": 0, "1": 1, "2": 2 });

    return {
      gameId: "breakthrough",
      gameName: "Breakthrough (5x5)",
      boardSpec: { type: "grid", rows: 5, cols: 5 },
      features: features,
      positions: [
        makePos("brk-01", "Starting wall", "opening", start, tweakEmbedding([0.52, 0.28, 0.22, 0.54, 0.50, 0.20], 0), tweakPca([-9.9, -8.5], 0), null, "Initial pawn wall."),
        makePos("brk-02", "Center probe", "opening", parseGrid(["22222", "20222", "00100", "11011", "11111"], { "0": 0, "1": 1, "2": 2 }), tweakEmbedding([0.66, 0.42, 0.28, 0.73, 0.58, 0.31], 1), tweakPca([-3.9, 8.1], 1), null, "Early central advance."),
        makePos("brk-03", "Spearhead A", "pressure", spear, tweakEmbedding([0.62, 0.64, 0.53, 0.61, 0.64, 0.52], 2), tweakPca([3.5, 7.4], 2), 71, "Forward spearhead."),
        makePos("brk-04", "Spearhead B", "pressure", mirrorMatrix(spear), tweakEmbedding([0.62, 0.64, 0.53, 0.61, 0.64, 0.52], 3), tweakPca([3.5, 7.4], 3), 71, "Mirrored spearhead."),
        makePos("brk-05", "Open lane A", "threat", lane, tweakEmbedding([0.47, 0.84, 0.46, 0.50, 0.57, 0.70], 4), tweakPca([10.4, 3.8], 4), 72, "Promotion lane created."),
        makePos("brk-06", "Open lane B", "threat", mirrorMatrix(lane), tweakEmbedding([0.47, 0.84, 0.46, 0.50, 0.57, 0.70], 5), tweakPca([10.4, 3.8], 5), 72, "Mirror promotion lane."),
        makePos("brk-07", "Capture net", "midgame", parseGrid(["20222", "22020", "00100", "11011", "10111"], { "0": 0, "1": 1, "2": 2 }), tweakEmbedding([0.43, 0.63, 0.85, 0.45, 0.51, 0.78], 6), tweakPca([6.1, -0.5], 6), null, "Tactical captures available."),
        makePos("brk-08", "Defensive shell", "defense", parseGrid(["22202", "22022", "00100", "11011", "11111"], { "0": 0, "1": 1, "2": 2 }), tweakEmbedding([0.58, 0.35, 0.42, 0.81, 0.46, 0.39], 7), tweakPca([-2.8, 1.2], 7), null, "Solid but passive shell."),
        makePos("brk-09", "Tempo race", "midgame", parseGrid(["22022", "22002", "00100", "10111", "11101"], { "0": 0, "1": 1, "2": 2 }), tweakEmbedding([0.41, 0.72, 0.55, 0.38, 0.89, 0.57], 8), tweakPca([0.9, -4.1], 8), null, "Who promotes first?"),
        makePos("brk-10", "Breakthrough A", "endgame", parseGrid(["20022", "02000", "00100", "10101", "11001"], { "0": 0, "1": 1, "2": 2 }), tweakEmbedding([0.36, 0.92, 0.64, 0.29, 0.77, 0.88], 9), tweakPca([11.7, -2.9], 9), 73, "Almost promoted pawn."),
        makePos("brk-11", "Breakthrough B", "endgame", mirrorMatrix(parseGrid(["20022", "02000", "00100", "10101", "11001"], { "0": 0, "1": 1, "2": 2 })), tweakEmbedding([0.36, 0.92, 0.64, 0.29, 0.77, 0.88], 10), tweakPca([11.7, -2.9], 10), 73, "Mirror almost-promoted pawn."),
        makePos("brk-12", "Final race", "endgame", parseGrid(["20020", "02000", "00010", "10001", "01001"], { "0": 0, "1": 1, "2": 2 }), tweakEmbedding([0.33, 0.97, 0.45, 0.24, 0.84, 0.95], 11), tweakPca([2.3, -10.7], 11), null, "Terminal promotion race.")
      ]
    };
  }

  function buildNineMensMorris() {
    const features = ["mills", "mobility", "material", "double_threat", "blockades", "phase_progress"];
    const millA = nmmState([0, 1, 2, 9, 21], [3, 4, 5, 14, 23]);
    const trapA = nmmState([0, 9, 21, 3, 10], [2, 14, 23, 5, 13]);

    return {
      gameId: "nmm",
      gameName: "Nine Men's Morris",
      boardSpec: { type: "points", points: 24 },
      features: features,
      positions: [
        makePos("nmm-01", "Opening spread", "opening", nmmState([0, 4, 9, 13], [2, 10, 14, 22]), tweakEmbedding([0.28, 0.69, 0.50, 0.24, 0.36, 0.19], 0), tweakPca([-10.8, -7.3], 0), null, "No mills formed yet."),
        makePos("nmm-02", "Outer mill A", "pressure", millA, tweakEmbedding([0.91, 0.52, 0.61, 0.48, 0.44, 0.46], 1), tweakPca([4.2, 8.9], 1), 81, "Top row mill formed."),
        makePos("nmm-03", "Outer mill B", "pressure", mirrorNmm(millA), tweakEmbedding([0.91, 0.52, 0.61, 0.48, 0.44, 0.46], 2), tweakPca([4.2, 8.9], 2), 81, "Mirror top row mill."),
        makePos("nmm-04", "Center tension", "midgame", nmmState([1, 4, 7, 16, 22], [0, 3, 5, 13, 19]), tweakEmbedding([0.44, 0.63, 0.49, 0.58, 0.52, 0.41], 3), tweakPca([-2.0, 4.9], 3), null, "Contested central points."),
        makePos("nmm-05", "Double threat A", "threat", nmmState([0, 9, 21, 1, 4, 7], [2, 14, 23, 3, 5]), tweakEmbedding([0.75, 0.41, 0.66, 0.90, 0.48, 0.56], 4), tweakPca([10.9, 3.2], 4), 82, "Two near-mills from one move."),
        makePos("nmm-06", "Double threat B", "threat", mirrorNmm(nmmState([0, 9, 21, 1, 4, 7], [2, 14, 23, 3, 5])), tweakEmbedding([0.75, 0.41, 0.66, 0.90, 0.48, 0.56], 5), tweakPca([10.9, 3.2], 5), 82, "Mirror double threat."),
        makePos("nmm-07", "Trap net A", "threat", trapA, tweakEmbedding([0.64, 0.38, 0.53, 0.81, 0.74, 0.52], 6), tweakPca([7.1, -1.2], 6), 83, "Opponent mobility restricted."),
        makePos("nmm-08", "Trap net B", "threat", mirrorNmm(trapA), tweakEmbedding([0.64, 0.38, 0.53, 0.81, 0.74, 0.52], 7), tweakPca([7.1, -1.2], 7), 83, "Mirror restricted mobility trap."),
        makePos("nmm-09", "Flying phase prep", "midgame", nmmState([0, 1, 9, 17], [2, 5, 14, 23]), tweakEmbedding([0.39, 0.77, 0.45, 0.35, 0.28, 0.71], 8), tweakPca([-5.5, -0.2], 8), null, "Approaching low-piece phase."),
        makePos("nmm-10", "Late blockade", "defense", nmmState([1, 4, 7, 10, 16], [0, 2, 5, 14, 22]), tweakEmbedding([0.52, 0.35, 0.58, 0.44, 0.87, 0.76], 9), tweakPca([-0.8, -6.0], 9), null, "Blocking key lines."),
        makePos("nmm-11", "Near terminal A", "endgame", nmmState([0, 1, 2, 9], [14, 22, 23]), tweakEmbedding([0.86, 0.30, 0.77, 0.52, 0.61, 0.93], 10), tweakPca([10.8, -4.8], 10), 84, "Material and mill edge."),
        makePos("nmm-12", "Near terminal B", "endgame", mirrorNmm(nmmState([0, 1, 2, 9], [14, 22, 23])), tweakEmbedding([0.86, 0.30, 0.77, 0.52, 0.61, 0.93], 11), tweakPca([10.8, -4.8], 11), 84, "Mirror near-terminal advantage.")
      ]
    };
  }

  function buildQuoridor() {
    const features = ["race_lead", "wall_economy", "path_safety", "blocking", "mobility", "initiative"];
    const funnel = qBoard([4, 2], [0, 2], [[1, 1], [2, 1]], [[1, 2], [2, 2]]);
    const centerWall = qBoard([3, 2], [1, 2], [[1, 1], [2, 2]], [[1, 1], [2, 3]]);
    const squeeze = qBoard([4, 1], [0, 3], [[0, 1], [2, 2], [3, 1]], [[1, 2], [2, 1]]);

    return {
      gameId: "quoridor",
      gameName: "Quoridor (5x5)",
      boardSpec: { type: "grid_walls", size: 5 },
      features: features,
      positions: [
        makePos("qrd-01", "Start", "opening", qBoard([4, 2], [0, 2], [], []), tweakEmbedding([0.50, 0.50, 0.50, 0.40, 0.60, 0.45], 0), tweakPca([-10.1, -8.1], 0), null, "Equal race from baseline."),
        makePos("qrd-02", "Center race", "opening", qBoard([3, 2], [1, 2], [], []), tweakEmbedding([0.62, 0.45, 0.53, 0.36, 0.71, 0.59], 1), tweakPca([-3.8, 8.7], 1), null, "Both pawns advanced centrally."),
        makePos("qrd-03", "Funnel A", "pressure", funnel, tweakEmbedding([0.56, 0.74, 0.66, 0.81, 0.42, 0.58], 2), tweakPca([4.1, 8.2], 2), 91, "Channeling opponent into long path."),
        makePos("qrd-04", "Funnel B", "pressure", mirrorQuoridor(funnel), tweakEmbedding([0.56, 0.74, 0.66, 0.81, 0.42, 0.58], 3), tweakPca([4.1, 8.2], 3), 91, "Mirror channeling setup."),
        makePos("qrd-05", "Center wall web A", "midgame", centerWall, tweakEmbedding([0.49, 0.83, 0.71, 0.72, 0.40, 0.63], 4), tweakPca([9.7, 3.9], 4), 92, "Cross-wall traffic shaping."),
        makePos("qrd-06", "Center wall web B", "midgame", mirrorQuoridor(centerWall), tweakEmbedding([0.49, 0.83, 0.71, 0.72, 0.40, 0.63], 5), tweakPca([9.7, 3.9], 5), 92, "Mirror cross-wall setup."),
        makePos("qrd-07", "Squeeze A", "threat", squeeze, tweakEmbedding([0.68, 0.62, 0.59, 0.86, 0.49, 0.72], 6), tweakPca([7.0, -0.7], 6), 93, "Opponent boxed toward corner lane."),
        makePos("qrd-08", "Squeeze B", "threat", mirrorQuoridor(squeeze), tweakEmbedding([0.68, 0.62, 0.59, 0.86, 0.49, 0.72], 7), tweakPca([7.0, -0.7], 7), 93, "Mirror boxed lane."),
        makePos("qrd-09", "Low-wall sprint", "midgame", qBoard([2, 2], [1, 3], [[3, 1]], [[2, 2]]), tweakEmbedding([0.78, 0.34, 0.66, 0.35, 0.81, 0.74], 8), tweakPca([-1.0, -4.8], 8), null, "Racing with wall conservation."),
        makePos("qrd-10", "Commit wall stack", "defense", qBoard([4, 2], [2, 2], [[1, 1], [1, 2], [2, 1]], [[0, 2], [2, 2], [3, 1]]), tweakEmbedding([0.32, 0.92, 0.54, 0.89, 0.21, 0.43], 9), tweakPca([-5.8, -2.1], 9), null, "High wall spend for blockade."),
        makePos("qrd-11", "Finish lane A", "endgame", qBoard([1, 2], [4, 1], [[2, 0], [2, 2]], [[1, 1], [3, 2]]), tweakEmbedding([0.91, 0.27, 0.79, 0.44, 0.88, 0.92], 10), tweakPca([11.9, -3.2], 10), 94, "Immediate path completion threat."),
        makePos("qrd-12", "Finish lane B", "endgame", mirrorQuoridor(qBoard([1, 2], [4, 1], [[2, 0], [2, 2]], [[1, 1], [3, 2]])), tweakEmbedding([0.91, 0.27, 0.79, 0.44, 0.88, 0.92], 11), tweakPca([11.9, -3.2], 11), 94, "Mirror finish lane threat.")
      ]
    };
  }

  function buildData() {
    return [
      buildTicTacToe(),
      buildConnect4(),
      buildOthello(),
      buildGomoku(),
      buildCheckers(),
      buildGo(),
      buildHex(),
      buildBreakthrough(),
      buildNineMensMorris(),
      buildQuoridor()
    ];
  }

  function validateData(data) {
    if (!Array.isArray(data) || data.length !== 10) {
      throw new Error("Dataset must contain exactly 10 games.");
    }
    data.forEach(function (game) {
      if (!Array.isArray(game.positions) || game.positions.length < 10 || game.positions.length > 15) {
        throw new Error("Game " + game.gameId + " must have 10-15 positions.");
      }
      game.positions.forEach(function (pos) {
        if (pos.embedding.length !== game.features.length) {
          throw new Error("Embedding dimension mismatch in " + pos.id);
        }
      });
    });
  }

  const data = buildData();
  validateData(data);
  window.BoardSpaceAtlasData = data;
})();
