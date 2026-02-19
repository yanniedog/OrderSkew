/**
 * Cloudflare Pages Function: POST /api/names/generate
 * Proxies name generation requests to Namelix's internal API (load13.php).
 * The Namelix API is asynchronous: the first call queues generation,
 * subsequent polls with the same request_id return results when ready.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const NAMELIX_URL = "https://namelix.com/app/load13.php";
const MAX_POLLS = 12;
const POLL_INTERVAL_MS = 2500;

const STYLE_MAP = {
  default: "",
  brandable: "brandable",
  twowords: "compound",
  threewords: "compound",
  compound: "compound",
  spelling: "spelling",
  nonenglish: "non_english",
  dictionary: "real_word",
};

const LENGTH_MAP = {
  short: "short",
  medium: "medium",
  long: "long",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapMaxLengthToBucket(maxLength) {
  const n = Number(maxLength) || 15;
  if (n <= 10) return "short";
  if (n <= 18) return "medium";
  return "long";
}

function toLabel(businessName) {
  const s = String(businessName || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s || s.length > 63 || !/^[a-z0-9-]+$/.test(s)) return null;
  return s;
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ code: "INVALID_REQUEST", message: "JSON body required." }, 400);
  }

  const keywords = String(body.keywords || "").trim();
  if (!keywords || keywords.length < 2) {
    return json({ code: "INVALID_REQUEST", message: "keywords must be at least 2 characters." }, 400);
  }

  const description = String(body.description || "").trim();
  const blacklist = String(body.blacklist || "").trim();
  const maxLength = Math.min(25, Math.max(5, Math.round(Number(body.maxLength) || 15)));
  const tld = String(body.tld || "com").toLowerCase().replace(/^\./, "");
  const style = STYLE_MAP[body.style] != null ? STYLE_MAP[body.style] : "";
  const randomness = body.randomness === "low" ? "low" : body.randomness === "high" ? "high" : "medium";
  const maxNames = Math.min(200, Math.max(1, Math.round(Number(body.maxNames) || 30)));
  const prevNames = Array.isArray(body.prevNames) ? body.prevNames.join("|") : "";
  const seed = Math.floor(Math.random() * 4294967290);

  const requestId = uuid();
  const formData = new URLSearchParams();
  formData.append("request_id", requestId);
  formData.append("keywords", keywords);
  formData.append("description", description);
  formData.append("blacklist", blacklist);
  formData.append("max_length", String(maxLength));
  formData.append("style", style);
  formData.append("random", randomness);
  formData.append("extensions[]", tld);
  formData.append("require_domains", "false");
  formData.append("prev_names", prevNames);
  formData.append("saved", "");
  formData.append("premium_index", "0");
  formData.append("page", "0");
  formData.append("num", "4");
  formData.append("seed", String(seed));
  formData.append("category", "");

  const namelixHeaders = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "https://namelix.com",
    "Referer": "https://namelix.com/app/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };

  const _debug = {
    namelixEndpoint: NAMELIX_URL,
    requestId,
    keywords,
    description,
    style,
    randomness,
    tld,
    maxLength,
    maxNames,
    seed,
    dataSource: "Namelix API (namelix.com)",
    syntheticData: false,
    timestamp: new Date().toISOString(),
  };

  let logos = [];
  let pollCount = 0;

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    pollCount = attempt + 1;
    let res;
    try {
      res = await fetch(NAMELIX_URL, {
        method: "POST",
        headers: namelixHeaders,
        body: formData.toString(),
      });
    } catch (e) {
      _debug.fetchError = (e && e.message) || "Namelix request failed.";
      return json({ code: "NAMELIX_ERROR", message: _debug.fetchError, names: [], _debug }, 502);
    }

    if (!res.ok) {
      _debug.namelixStatus = res.status;
      _debug.namelixStatusText = res.statusText || "";
      return json({ code: "NAMELIX_ERROR", message: `Namelix returned ${res.status}`, names: [], _debug }, 502);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      _debug.parseError = true;
      return json({ code: "NAMELIX_ERROR", message: "Failed to parse Namelix response.", names: [], _debug }, 502);
    }

    if (Array.isArray(data) && data.length > 0) {
      logos = data;
      break;
    }

    if (attempt < MAX_POLLS - 1) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  _debug.pollCount = pollCount;
  _debug.namelixRawCount = logos.length;

  const seen = new Set();
  const names = [];

  for (const logo of logos) {
    if (names.length >= maxNames) break;
    const businessName = String(logo.businessName || "").trim();
    if (!businessName) continue;

    const label = toLabel(businessName);
    if (!label || label.length > maxLength) continue;

    const domain = `${label}.${tld}`;
    const key = domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    names.push({
      domain,
      businessName,
      sourceName: businessName,
      hasDomain: Boolean(logo.hasDomain),
      namelixDomains: logo.domains || "",
      source: "namelix",
    });
  }

  _debug.deduplicatedCount = names.length;
  _debug.sampleNames = names.slice(0, 5).map(function (n) {
    return { domain: n.domain, businessName: n.businessName };
  });

  return json({ names, _debug });
}
