/**
 * Cloudflare Worker: domain availability API for the Domain Name Wizard.
 * Deploy with Wrangler; set GODADDY_API_KEY, GODADDY_API_SECRET, GODADDY_ENV as encrypted secrets.
 *
 * Usage: In the wizard, set Backend URL to this Worker's URL (e.g. https://your-worker.your-subdomain.workers.dev).
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
  });
}

function getBaseUrl(env) {
  const mode = (env.GODADDY_ENV || "OTE").toUpperCase();
  return mode === "PROD" ? "https://api.godaddy.com" : "https://api.ote-godaddy.com";
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "POST" || !request.url.endsWith("/api/domains/availability")) {
      return json({ code: "NOT_FOUND", message: "POST /api/domains/availability only." }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ code: "INVALID_REQUEST", message: "JSON body required." }, 400);
    }

    const raw = Array.isArray(body.domains) ? body.domains : [];
    const domains = raw.filter((d) => typeof d === "string" && d.trim().length > 0).map((d) => d.trim().toLowerCase());
    const unique = [...new Set(domains)];

    if (unique.length === 0) {
      return json({ code: "INVALID_REQUEST", message: "domains must be a non-empty string array." }, 400);
    }
    if (unique.length > 100) {
      return json({ code: "INVALID_REQUEST", message: "At most 100 domains per request." }, 400);
    }

    const apiKey = env.GODADDY_API_KEY;
    const apiSecret = env.GODADDY_API_SECRET;
    if (!apiKey || !apiSecret) {
      return json({ code: "GODADDY_AUTH", message: "Missing GoDaddy API credentials (secrets)." }, 502);
    }

    const baseUrl = getBaseUrl(env);
    const endpoint = `${baseUrl}/v1/domains/available?checkType=FAST`;

    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `sso-key ${apiKey}:${apiSecret}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(unique),
      });
    } catch (e) {
      return json({ code: "GODADDY_API", message: (e && e.message) || "GoDaddy request failed." }, 502);
    }

    if (res.status === 429) {
      return json({ code: "GODADDY_RATE_LIMIT", message: "GoDaddy rate limit reached." }, 429);
    }
    if (res.status === 401 || res.status === 403) {
      return json({ code: "GODADDY_AUTH", message: "GoDaddy authentication failed." }, 502);
    }
    if (!res.ok) {
      const text = await res.text();
      return json({ code: "GODADDY_API", message: `GoDaddy error (${res.status}): ${text.slice(0, 200)}` }, 502);
    }

    const data = await res.json().catch(() => ({}));
    const results = {};

    for (const d of data.domains || []) {
      const key = (d.domain || "").toLowerCase();
      if (!key) continue;
      const price = typeof d.price === "number" && Number.isFinite(d.price) ? Number(Number(d.price).toFixed(2)) : undefined;
      results[key] = {
        available: Boolean(d.available),
        definitive: Boolean(d.definitive),
        price,
        currency: d.currency || "USD",
        period: d.period != null ? d.period : 1,
        reason: d.available ? "Available (GoDaddy)." : "Unavailable (GoDaddy).",
      };
    }
    for (const e of data.errors || []) {
      const key = (e.domain || "").toLowerCase();
      if (!key) continue;
      results[key] = {
        available: false,
        definitive: false,
        reason: e.message || e.code || "Error from GoDaddy.",
      };
    }
    for (const domain of unique) {
      if (!results[domain]) {
        results[domain] = { available: false, definitive: false, reason: "No availability response." };
      }
    }

    return json({ results });
  },
};
