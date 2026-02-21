/**
 * Cloudflare Pages Function: POST /api/dev-ecosystem
 * Aggregates developer-ecosystem signal for tokens using GitHub + npm.
 * Optional secret: GITHUB_TOKEN (recommended to avoid low unauthenticated limits).
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
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

  const wordsRaw = Array.isArray(body && body.words) ? body.words : [];
  const words = [...new Set(
    wordsRaw
      .filter((w) => typeof w === "string")
      .map((w) => String(w).toLowerCase().trim())
      .filter((w) => /^[a-z0-9-]{3,24}$/.test(w))
  )].slice(0, 30);

  if (!words.length) return json({ scores: {}, details: {}, _debug: { words: 0 } }, 200);

  let ghToken = String(env.GITHUB_TOKEN || "").trim();
  const emptyTokenValues = ["", "undefined", "none", "null", "false"];
  if (emptyTokenValues.includes(ghToken.toLowerCase())) ghToken = "";
  const scores = {};
  const details = {};
  const _debug = {
    provider: "github+npm",
    githubTokenPresent: Boolean(ghToken),
    wordsRequested: words.length,
    githubCalls: 0,
    githubSuccess: 0,
    githubFailures: 0,
    npmCalls: 0,
    npmSuccess: 0,
    npmFailures: 0,
    sampleErrors: [],
  };

  for (const word of words) {
    let githubRepos = 0;
    let npmPackages = 0;

    try {
      _debug.githubCalls += 1;
      const headers = { Accept: "application/vnd.github.v3+json" };
      if (ghToken) headers.Authorization = "token " + ghToken;
      const ghResp = await fetch(
        "https://api.github.com/search/repositories?q=" + encodeURIComponent(word) + "&per_page=1",
        { headers }
      );
      if (ghResp.ok) {
        const ghData = await ghResp.json();
        githubRepos = Math.min(Number(ghData.total_count) || 0, 500000);
        _debug.githubSuccess += 1;
      } else {
        _debug.githubFailures += 1;
        if (_debug.sampleErrors.length < 5) _debug.sampleErrors.push(`github:${word}:HTTP ${ghResp.status}`);
      }
    } catch (err) {
      _debug.githubFailures += 1;
      if (_debug.sampleErrors.length < 5) _debug.sampleErrors.push(`github:${word}:${(err && err.message) || "error"}`);
    }

    try {
      _debug.npmCalls += 1;
      const npmResp = await fetch(
        "https://registry.npmjs.org/-/v1/search?text=" + encodeURIComponent(word) + "&size=1"
      );
      if (npmResp.ok) {
        const npmData = await npmResp.json();
        npmPackages = Math.min((Number(npmData.total) || 0) * 10, 100000);
        _debug.npmSuccess += 1;
      } else {
        _debug.npmFailures += 1;
        if (_debug.sampleErrors.length < 5) _debug.sampleErrors.push(`npm:${word}:HTTP ${npmResp.status}`);
      }
    } catch (err) {
      _debug.npmFailures += 1;
      if (_debug.sampleErrors.length < 5) _debug.sampleErrors.push(`npm:${word}:${(err && err.message) || "error"}`);
    }

    const total = githubRepos + npmPackages;
    scores[word] = total;
    details[word] = {
      total,
      githubRepos,
      npmPackages,
      source: "backend",
      githubTokenUsed: Boolean(ghToken),
    };
    await new Promise((r) => setTimeout(r, 300));
  }

  return json({ scores, details, _debug }, 200);
}
