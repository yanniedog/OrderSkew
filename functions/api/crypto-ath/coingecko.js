const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const ALLOWED_PATHS = new Set([
  "/coins/markets",
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = String(url.searchParams.get("path") || "");
  if (!ALLOWED_PATHS.has(path)) {
    return json({ code: "INVALID_PATH", message: "Unsupported CoinGecko path." }, 400);
  }

  const upstream = new URL(COINGECKO_BASE + path);
  for (const [k, v] of url.searchParams.entries()) {
    if (k === "path") continue;
    upstream.searchParams.set(k, v);
  }

  let res;
  try {
    res = await fetch(upstream.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    return json({ code: "UPSTREAM_FETCH_FAILED", message: (e && e.message) || "CoinGecko fetch failed." }, 502);
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

