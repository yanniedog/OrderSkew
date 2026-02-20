/**
 * Central config for production E2E. Base URL from argv or env; asset and URL lists for exhaustive checks.
 * Usage: baseUrl is from process.argv[2] or BASE_URL env or default.
 */

const defaultBase = "https://www.orderskew.com";

function getBaseUrl() {
  const fromArgv = typeof process !== "undefined" && process.argv && process.argv[2];
  const fromEnv = typeof process !== "undefined" && process.env && process.env.BASE_URL;
  const base = (fromArgv || fromEnv || defaultBase).toString().replace(/\/$/, "");
  return base;
}

const ROOT_ASSETS = [
  "styles.css",
  "app.js",
  "wizard-questions.js",
  "wizard.js",
  "charts.js",
  "charts-how-it-works.js",
  "main.navigation.js",
  "main.ui.js",
  "main.calculator.js",
  "main.events.chart.js",
  "main.events.intro.js",
  "main.events.js",
  "main.js",
  "fix-vscode-links.js",
  "page-frame.js",
];

const TOOL_ASSETS = {
  nab_homeloan_calculator: {
    basePath: "/pages/nab_homeloan_calculator",
    assets: ["index.html", "styles.css", "nab_utils.js", "app.js", "../../page-frame.js"],
  },
  crypto_ath_drawdown_cycles: {
    basePath: "/pages/crypto_ath_drawdown_cycles",
    assets: ["index.html", "styles.css", "app.js", "../../page-frame.js"],
  },
  chess_tree: {
    basePath: "/pages/chess_tree",
    assets: ["index.html", "styles.css", "app.js", "assets/chess.min.js", "../../page-frame.js"],
  },
};

const TOOLS_HUB_LINKS = [
  "/pages/nab_homeloan_calculator/index.html",
  "/pages/novel_indicator/index.html",
  "/pages/domainname_wizard/index.html",
  "/pages/crypto_ath_drawdown_cycles/index.html",
  "/pages/chess_tree/index.html",
];

const ROOT_SAME_ORIGIN_LINKS = ["/pages/index.html"];

const NOT_FOUND_PATHS = ["/api/nonexistent", "/pages/fake-tool.html"];

const NOVEL_API_CHECKS = [
  { path: "/api/health", method: "GET", expectStatus: 200, expectJson: true, expectStatusOk: true },
  { path: "/api/auth/session", method: "GET", expectStatus: [401, 200], expectJson: true },
  { path: "/api/auth/login", method: "POST", body: {}, expectStatus: [400, 422], expectJson: true },
  { path: "/api/me", method: "GET", expectStatus: 401, expectJson: true },
  { path: "/api/nonexistent", method: "GET", expectStatus: 404, expectJson: true },
];

module.exports = {
  getBaseUrl,
  ROOT_ASSETS,
  TOOL_ASSETS,
  TOOLS_HUB_LINKS,
  ROOT_SAME_ORIGIN_LINKS,
  NOT_FOUND_PATHS,
  NOVEL_API_CHECKS,
};
