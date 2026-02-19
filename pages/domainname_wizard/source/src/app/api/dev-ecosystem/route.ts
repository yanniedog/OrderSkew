import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200, headers = {}) {
  return NextResponse.json(data, {
    status,
    headers: { ...CORS_HEADERS, ...headers },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { words?: unknown[] };
    const raw = Array.isArray(body.words) ? body.words : [];
    const words = [...new Set(raw.filter((w): w is string => typeof w === "string" && w.length >= 3))].slice(0, 30);

    if (words.length === 0) {
      return json({ scores: {} });
    }

    const token = process.env.GITHUB_TOKEN || "";
    const scores: Record<string, number> = {};

    for (const word of words) {
      let total = 0;
      try {
        const headers: Record<string, string> = {
          Accept: "application/vnd.github.v3+json",
        };
        if (token) headers.Authorization = "token " + token;
        const ghResp = await fetch(
          "https://api.github.com/search/repositories?q=" +
            encodeURIComponent(word) +
            "&per_page=1",
          { headers }
        );
        if (ghResp.ok) {
          const ghData = await ghResp.json();
          total += Math.min(ghData.total_count || 0, 500000);
        }
      } catch {
        /* ignore */
      }
      try {
        const npmResp = await fetch(
          "https://registry.npmjs.org/-/v1/search?text=" +
            encodeURIComponent(word) +
            "&size=1"
        );
        if (npmResp.ok) {
          const npmData = await npmResp.json();
          total += Math.min((npmData.total || 0) * 10, 100000);
        }
      } catch {
        /* ignore */
      }
      scores[word] = total;
      await new Promise((r) => setTimeout(r, 600));
    }

    return json({ scores });
  } catch {
    return json(
      { code: "INTERNAL_ERROR", message: "Dev ecosystem lookup failed." },
      500
    );
  }
}
