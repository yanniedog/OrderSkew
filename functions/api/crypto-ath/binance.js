const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BINANCE_BASES = [
  "https://api.binance.com/api/v3",
  "https://api.binance.us/api/v3",
  "https://data-api.binance.vision/api/v3",
];
const ALLOWED_PATHS = new Set([
  "/exchangeInfo",
  "/klines",
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
    return json({ code: "INVALID_PATH", message: "Unsupported Binance path." }, 400);
  }

  let lastStatus = 502;
  let lastBody = JSON.stringify({ code: "UPSTREAM_FETCH_FAILED", message: "Binance fetch failed." });

  for (const base of BINANCE_BASES) {
    const upstream = new URL(base + path);
    for (const [k, v] of url.searchParams.entries()) {
      if (k === "path") continue;
      upstream.searchParams.set(k, v);
    }

    try {
      const res = await fetch(upstream.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "OrderSkewCryptoAth/1.0 (+https://orderskew.com/pages/crypto_ath_drawdown_cycles/)",
        },
      });
      const body = await res.text();
      if (res.ok) {
        return new Response(body, {
          status: res.status,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      lastStatus = res.status;
      lastBody = body || lastBody;
    } catch (e) {
      lastStatus = 502;
      lastBody = JSON.stringify({ code: "UPSTREAM_FETCH_FAILED", message: (e && e.message) || "Binance fetch failed." });
    }
  }

  return new Response(lastBody, {
    status: lastStatus,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
