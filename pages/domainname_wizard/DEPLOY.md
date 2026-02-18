# Deploy the wizard backend (GoDaddy key kept secret)

**Easiest and most reliable: Vercel.** Use your existing Next.js API; no extra code. All setup in the browser (GitHub + Vercel dashboard). About 5 minutes.

---

## Option A: Vercel (recommended)

### Why Vercel
- Uses your **existing** Next.js app and `/api/domains/availability` route. No new files.
- **Secrets in the UI**: add env vars in Vercel dashboard; no CLI.
- **One-time**: connect repo, set 3 env vars, deploy. Future pushes auto-deploy.
- Runs Node serverless functions; your API is already compatible.

### Prerequisites
- Repo on **GitHub** (this repo or a fork).
- GoDaddy API key and secret from [GoDaddy Developer](https://developer.godaddy.com/) (use OTE for test).

### Steps

1. **Go to [Vercel](https://vercel.com)** and sign in (GitHub is enough).

2. **Add New Project**
   - Click **Add New** → **Project**.
   - Import your GitHub repo (e.g. `orderskew`). Authorize Vercel if asked.

3. **Configure the project**
   - **Root Directory**: click **Edit**, set to **`pages/domainname_wizard/source`** (the folder with `package.json` and `next.config.js`). Leave **Framework Preset** as Next.js.
   - **Build Command**: leave as `npm run build` (or `next build`).
   - **Output Directory**: leave default.
   - Do **not** deploy yet.

4. **Add environment variables (the “secret” part)**
   - In the same screen, open **Environment Variables**.
   - Add:
     - **Name**: `GODADDY_API_KEY`  
       **Value**: (paste your GoDaddy API key)  
       **Environment**: Production (and Preview if you want).
     - **Name**: `GODADDY_API_SECRET`  
       **Value**: (paste your GoDaddy API secret)  
       **Environment**: Production (and Preview if you want).
     - **Name**: `GODADDY_ENV`  
       **Value**: `OTE` (test) or `PRODUCTION` (live)  
       **Environment**: Production (and Preview if you want).
   - Vercel does not show values after save; they are used only on the server.

5. **Deploy**
   - Click **Deploy**. Wait for the build to finish.
   - You’ll get a URL like **`https://your-project-xxx.vercel.app`**.

6. **Use the wizard**
   - Open the Domain Name Wizard (e.g. `pages/domainname_wizard/index.html` locally or wherever you host it).
   - In **Plan A: Backend URL**, enter the Vercel URL **with no trailing slash**, e.g.  
     `https://your-project-xxx.vercel.app`
   - Run a search. The wizard calls your Vercel app; the app uses the env vars to call GoDaddy; the key never goes to the browser.

### Summary (Vercel)
| Step | Where | What |
|------|--------|------|
| 1 | GitHub | Repo is already there |
| 2 | Vercel | Import project, set Root = `pages/domainname_wizard/source` |
| 3 | Vercel | Add GODADDY_API_KEY, GODADDY_API_SECRET, GODADDY_ENV |
| 4 | Vercel | Deploy → copy URL |
| 5 | Wizard | Paste URL in Backend URL |

---

## Option B: Cloudflare Worker

Good if you prefer Cloudflare or want a tiny, single-file API with no Node build.

- **Code**: Already in this repo: `pages/domainname_wizard/source/cloudflare-availability-worker.js` and `wrangler.toml`.
- **Steps**: See [CLOUDFLARE.md](./CLOUDFLARE.md): install Wrangler, `wrangler secret put` for the three vars, then `wrangler deploy`. Use the Worker URL as the wizard’s Backend URL.

---

## Comparison

| | Vercel | Cloudflare Worker |
|--|--------|-------------------|
| **Ease** | All in browser (GitHub + Vercel UI) | CLI: Wrangler + `secret put` |
| **New code** | None (use existing Next.js API) | One small Worker file (already added) |
| **Secrets** | Vercel dashboard → Environment Variables | `wrangler secret put` |
| **Reliability** | Next.js + serverless, well supported | Single JS Worker, very stable |

**Recommendation:** Use **Vercel** (Option A) for the easiest and most reliable path with no extra implementation.
