# Cloudflare walkthrough: run the wizard with GoDaddy (keys kept secret)

You can run the Domain Name Wizard in the browser and have it call GoDaddy for availability **without ever putting your API key in the repo or in the browser**. The key stays in Cloudflare as an encrypted secret.

Two parts:

1. **Add your GoDaddy key as a secret in Cloudflare** (so it’s not public).
2. **Deploy a small API (Worker)** that uses that secret to call GoDaddy; the wizard calls your Worker.

---

## 1. Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up).
- [Node.js](https://nodejs.org/) (for the `wrangler` CLI).
- Your GoDaddy API key and secret (from [GoDaddy Developer](https://developer.godaddy.com/)); use **OTE** (test) or **Production** as needed.

---

## 2. Create the Worker and add secrets

### 2.1 Install Wrangler (one-time)

From the repo root or from `pages/domainname_wizard/source`:

```bash
npm install -g wrangler
```

Log in (opens browser):

```bash
wrangler login
```

### 2.2 Go to the source directory

```bash
cd pages/domainname_wizard/source
```

### 2.3 Create the Worker in the Cloudflare dashboard (optional)

- Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**.
- Click **Create** → **Create Worker**.
- Name it e.g. `domainname-wizard-availability` (or any name).
- You’ll deploy the code in the next step; this step is only if you want to create the Worker from the UI first.

Alternatively, the first time you run `wrangler deploy` (below), Cloudflare will create the Worker for you.

### 2.4 Add your GoDaddy keys as **encrypted** secrets

Never put the key in code or in `wrangler.toml`. Use **secrets** so only the Worker can read them.

In the **same directory** (`pages/domainname_wizard/source`), run:

```bash
npx wrangler secret put GODADDY_API_KEY
```

When prompted, paste your GoDaddy API key and press Enter.

Then:

```bash
npx wrangler secret put GODADDY_API_SECRET
```

Paste your GoDaddy API secret.

Optional (default is OTE = test environment):

```bash
npx wrangler secret put GODADDY_ENV
```

Enter `OTE` for test or `PRODUCTION` for live.

You can confirm they’re set (names only, not values) in the dashboard: **Workers & Pages** → your worker → **Settings** → **Variables and Secrets**.

---

## 3. Deploy the Worker

From `pages/domainname_wizard/source`:

```bash
npx wrangler deploy
```

Wrangler will build and deploy the Worker. At the end you’ll see a URL like:

```text
https://domainname-wizard-availability.<your-subdomain>.workers.dev
```

That URL is your **Backend URL** for the wizard. The wizard will call:

`https://domainname-wizard-availability.<your-subdomain>.workers.dev/api/domains/availability`

---

## 4. Use the wizard

1. Open the Domain Name Wizard (e.g. open `pages/domainname_wizard/index.html` locally or your deployed site).
2. In **Plan A: Backend URL**, enter the Worker URL **with no trailing slash**, e.g.  
   `https://domainname-wizard-availability.<your-subdomain>.workers.dev`
3. Fill in keywords and run the search.

The wizard runs in your browser and sends domain lists to **your** Worker. The Worker uses the **secret** GoDaddy keys to call GoDaddy; the key never appears in the browser or in the repo.

---

## 5. Summary: where the key lives

| Place                         | Key stored? |
|------------------------------|-------------|
| Your repo / GitHub            | No (never commit it) |
| Browser / wizard page         | No (only talks to your Worker) |
| Cloudflare (encrypted secret)| Yes (only the Worker can read it) |

So you **can** “give” the key to Cloudflare “secretly”: you add it as an encrypted secret in the dashboard or via `wrangler secret put`. It’s not public and is only used by your Worker on the server side.

---

## 6. Optional: custom domain and Pages

- **Custom domain**: In **Workers & Pages** → your worker → **Settings** → **Triggers**, add a **Route** (e.g. `api.yourdomain.com/api/domains/availability`) so the wizard can use `https://api.yourdomain.com` as the Backend URL.
- **Wizard UI on Cloudflare**: To host the wizard itself on Cloudflare, use **Pages**: connect your repo, set build output to the folder that contains the wizard’s static files (e.g. `pages/domainname_wizard` or your built site), and deploy. The wizard page will then be served from a `*.pages.dev` (or your custom) URL; keep using the Worker URL as the Backend URL so the key stays only in the Worker.
