/**
 * Cloudflare Pages Function: POST /api/domains/availability
 * Same contract as cloudflare-availability-worker.js so the wizard works when
 * BACKEND_URL is the Pages origin (e.g. orderskew.pages.dev).
 * Set in Pages: GODADDY_API_KEY, GODADDY_API_SECRET, GODADDY_ENV (optional, default OTE).
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
  const mode = String(env.GODADDY_ENV || "OTE").trim().toUpperCase();
  return mode === "PROD" || mode === "PRODUCTION" || mode === "LIVE"
    ? "https://api.godaddy.com"
    : "https://api.ote-godaddy.com";
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ code: "INVALID_REQUEST", message: "JSON body required." }, 400);
  }

  if (body == null || typeof body !== "object") {
    return json({ code: "INVALID_REQUEST", message: "JSON body must be an object." }, 400);
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

  const _debug = {
    credentialsSource: "Cloudflare Pages env bindings",
    apiKeyPresent: Boolean(apiKey),
    apiKeyPrefix: apiKey ? String(apiKey).slice(0, 6) + "..." : null,
    apiSecretPresent: Boolean(apiSecret),
    godaddyEnv: String(env.GODADDY_ENV || "OTE"),
    domainCount: unique.length,
    sampleDomains: unique.slice(0, 3),
    timestamp: new Date().toISOString(),
  };

  if (!apiKey || !apiSecret) {
    return json({ code: "GODADDY_AUTH", message: "Missing GoDaddy API credentials (secrets).", _debug }, 502);
  }

  const baseUrl = getBaseUrl(env);
  const endpoint = `${baseUrl}/v1/domains/available?checkType=FAST`;
  _debug.godaddyBaseUrl = baseUrl;
  _debug.godaddyEndpoint = endpoint;

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
    _debug.fetchError = (e && e.message) || "GoDaddy request failed.";
    return json({ code: "GODADDY_API", message: _debug.fetchError, _debug }, 502);
  }

  _debug.godaddyStatus = res.status;
  _debug.godaddyStatusText = res.statusText || "";

  if (res.status === 429) {
    return json({ code: "GODADDY_RATE_LIMIT", message: "GoDaddy rate limit reached.", _debug }, 429);
  }
  if (res.status === 401 || res.status === 403) {
    _debug.authFailure = true;
    return json({ code: "GODADDY_AUTH", message: "GoDaddy authentication failed.", _debug }, 502);
  }
  if (!res.ok) {
    const text = await res.text();
    _debug.godaddyErrorBody = text.slice(0, 500);
    return json({ code: "GODADDY_API", message: `GoDaddy error (${res.status}): ${text.slice(0, 200)}`, _debug }, 502);
  }

  const data = await res.json().catch(() => ({}));
  _debug.godaddyResponseDomainCount = (data.domains || []).length;
  _debug.godaddyResponseErrorCount = (data.errors || []).length;
  _debug.dataSource = "GoDaddy API (LIVE)";
  _debug.syntheticData = false;

  const sampleRaw = (data.domains || []).slice(0, 2).map(function (d) {
    return { domain: d.domain, available: d.available, rawPrice: d.price, convertedPrice: typeof d.price === "number" ? Number((d.price / 1000000).toFixed(2)) : undefined };
  });
  _debug.sampleRawResponse = sampleRaw;

  const results = {};

  for (const d of data.domains || []) {
    const key = (d.domain || "").toLowerCase();
    if (!key) continue;
    const rawPrice = typeof d.price === "number" && Number.isFinite(d.price) ? d.price : undefined;
    const price = rawPrice != null ? Number((rawPrice / 1000000).toFixed(2)) : undefined;
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

  return json({ results, _debug });
}
