function normaliseBaseUrl(baseUrl) {
  if (!baseUrl) return "";
  return baseUrl.replace(/\/+$/, "");
}

async function requestJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const text = await response.text();
    throw new Error("HTTP " + response.status + " at " + url + (text ? ": " + text.slice(0, 180) : ""));
  }
  return response.json();
}

export async function fetchRoot(baseUrl) {
  const base = normaliseBaseUrl(baseUrl);
  return requestJson(base + "/api/position");
}

export async function fetchPosition(baseUrl, hash) {
  const base = normaliseBaseUrl(baseUrl);
  return requestJson(base + "/api/position/" + encodeURIComponent(hash));
}

export async function fetchStats(baseUrl) {
  const base = normaliseBaseUrl(baseUrl);
  return requestJson(base + "/api/stats");
}

export async function fetchMetrics(baseUrl) {
  const base = normaliseBaseUrl(baseUrl);
  return requestJson(base + "/api/metrics");
}

export async function fetchNeighbors(baseUrl, hash, parentLimit) {
  const base = normaliseBaseUrl(baseUrl);
  const query = parentLimit ? ("?parent_limit=" + encodeURIComponent(String(parentLimit))) : "";
  return requestJson(base + "/api/neighbors/" + encodeURIComponent(hash) + query);
}

export async function searchPositions(baseUrl, query) {
  const base = normaliseBaseUrl(baseUrl);
  return requestJson(base + "/api/search?q=" + encodeURIComponent(query));
}
