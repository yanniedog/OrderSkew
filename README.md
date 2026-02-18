# Trading Plan Calculator

An interactive, browser-based tool for designing and stress-testing staged buy and sell ladders. The interface couples capital allocation controls with rich visualisations so traders can iterate on execution plans, quantify fees, and export a complete run-book.

## Features
- Guided configuration form for capital, ladder width, skew, and rung count with instant plan recalculation.
- Advanced mode supporting sell-only adjustments, equal-quantity overrides, absolute vs. relative spacing, and configurable trading fees (percent or fixed) with settlement controls.
- Dual D3-powered charts that visualise buy and sell ladders, including hover tooltips and executed rung tracking.
- Detailed buy/sell order tables with progressive averages, fee disclosure, and net profit projections.
- Snapshot exports to CSV, XLS, and PDF powered by `html2canvas` and `jsPDF` for downstream reporting.
- Responsive Tailwind CSS layout optimised for desktop and mobile review.

## Getting Started
1. Ensure you have a modern desktop browser (latest Chrome, Edge, Firefox, or Safari).
2. Clone or download this repository.
3. Open `index.html` directly in your browser, or run a lightweight HTTP server for local development:
   ```bash
   # Python 3
   python -m http.server 8000
   ```
4. Adjust the configuration sliders and advanced options; the plan summary, charts, and ladders update automatically on every change.

## Exporting Plans
- Use the **Export Options** menu to download CSV, XLS, or PDF snapshots.
- CSV/XLS exports include current settings, summary metrics, and side-by-side ladders.
- PDF export captures the on-screen layout (configuration, charts, and tables) for quick sharing.

## Architecture Notes
- `index.html` hosts the static app shell and loads CDN dependencies (Tailwind CSS, D3.js v7, `html2canvas`, and `jsPDF`).
- Core logic is split across focused scripts: `app.js` (shared constants/state/calculator primitives), `main.navigation.js`, `main.ui.js`, `main.calculator.js`, `main.events.js`, and `main.js` (bootstrap/composition).
- `State.currentPlanData` remains the single source of truth so charts, tables, exports, and summaries stay consistent.
- Sell-only workflows clone baseline buy ladders, track executed rungs, and derive existing positions for accurate profit and fee calculations.

## Development Tips
- Keep browser dev tools open to monitor console logs and verify there are no warnings/errors while editing.
- When extending the calculator, preserve DRY principles by updating shared helpers (formatting, fee handling, export builders) instead of duplicating logic.
- If you introduce new dependencies, prefer CDN builds compatible with static hosting since the project is currently serverless.

## Additional Tools
- `pages/index.html` is the tools hub.
- `pages/novel_indicator/` hosts the Novel Indicator Lab static frontend.
- Novel Indicator optimization and Binance data fetching run locally in the end user browser (Web Worker) with no login required for runs.
- Optional account/profile persistence can still be handled by Cloudflare Worker + D1 when enabled.
- Binance API rate limits apply per end-user IP because calls are made directly from the browser to Binance.
- Full source for this tool lives under `tools/novel_indicator/` (frontend, Cloudflare API, migrations, deploy scripts, and legacy backend reference code).
- `pages/domainname_wizard/` hosts a browser-native Domain Name Wizard tool with local worker processing.
- Imported source snapshot from `C:\code\domainname-wizard` is stored at `pages/domainname_wizard/source/` (excluding `.next`, `node_modules`, and local env/debug artifacts).
- Full automated test (unit + E2E): from repo root run `node test-domainname-wizard.js`. Requires `npm install` in `pages/domainname_wizard/source/` and Playwright browsers (`npx playwright install chromium` in that directory) for E2E.


