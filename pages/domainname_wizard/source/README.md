# Domainname Wizard

Namelix-to-GoDaddy iterative domain optimizer.

## Features

- Collects Namelix-style naming preferences from a web form.
- Uses Playwright to run Namelix generation and scrape generated names.
- Normalizes names into domain candidates (`<name>.<tld>`).
- Enforces `maxLength` in backend before availability checks and scoring.
- Checks domain availability in bulk using official GoDaddy Domains API.
- Runs iterative AI-style tuning loops (`loopCount`, default `10`, max `250`):
  - Evolutionary keyword/description mutation.
  - Epsilon-greedy bandit selection for style/randomness/mutation intensity.
  - Local persistent learning model in `data/optimizer-state.json`.
- Streams live progress and incremental result snapshots during each loop and after each loop.
- Keeps only currently available domains in ranked/budget tables and quota accounting.
- Per-loop quota target is `maxNames` available domains; if `251` considered names is reached, the loop is flagged and partial available results are kept.
- Scores every discovered domain with:
  - `marketabilityScore` (memorability/brandability factors).
  - `financialValueScore` (availability/price/budget factors).
  - `overallScore` (price-aware-first blend).
- Produces deduped cross-loop ranking (`allRanked`) with metadata:
  - first/last seen loop
  - times discovered
  - value drivers and detractors
- Supports final ranking/sorting by:
  - marketability
  - financial value
  - alphabetical
  - syllable count
  - label length
- Keeps budget buckets (`withinBudget`, `overBudget`, `unavailable`) from aggregated cross-loop results.
- Uses async jobs with polling API endpoints and in-memory TTL storage.
- Includes throttling protections:
  - Namelix queue concurrency `1` with cooldown + jitter.
  - GoDaddy queue concurrency `3`, max `30` requests/minute.
- Includes unit and integration tests for normalization, scoring, sorting, optimizer state, and loop aggregation.

## Environment

Copy `.env.example` to `.env.local` and set:

```bash
GODADDY_API_KEY=your_key
GODADDY_API_SECRET=your_secret
GODADDY_ENV=OTE
```

`GODADDY_ENV` supports:

- `OTE` (default)
- `PROD` / `PRODUCTION` / `LIVE`

## Install

```bash
npm install
npm run playwright:install
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Single-file wizard (no setup)

Open **`index.html`** in the project root directly in a browser or host it on any static site (GitHub Pages, Netlify, etc.):

- **Open as file:** Enter your backend API URL in the "Backend API URL" field (e.g. `https://your-app.vercel.app`), click Save, then use the form. The URL is stored in `localStorage`.
- **Same-origin:** If you serve `index.html` from the same host as the Next.js app (e.g. `https://your-app.vercel.app/index.html`), no API URL is needed.
- **Static host + separate backend:** Serve `index.html` from your static host, set "Backend API URL" to your deployed Next.js URL, and ensure the backend allows CORS (this repo’s API routes and middleware are already configured for cross-origin use).

**Testing with the dev server:** Run `npm run dev`, then open [http://localhost:3000/index.html](http://localhost:3000/index.html) (a copy of the root `index.html` in `public/` so it works same-origin with no API URL needed). Or open the root `index.html` in your browser (file) and set Backend API URL to `http://localhost:3000` and click Save.

## API

- `POST /api/searches` -> starts async job, returns `{ jobId, status }`
- `GET /api/searches/:jobId` -> returns job status/progress/results plus `currentLoop` and `totalLoops`

### POST payload highlights

- `loopCount`: integer `1..250` (default `10`)
- `maxLength`: strict backend-enforced label length cap (`5..25`)

## Validate

```bash
npm test
npm run build
```
