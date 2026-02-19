import { describe, expect, it, vi } from "vitest";

import {
  buildExpandedKeywordString,
  enrichKeywords,
  expandWithDatamuse,
  expandWithWordnik,
  tokenizeSeedKeywords,
  type ExpandedToken,
} from "@/lib/keywords/enrichment";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("keyword enrichment", () => {
  it("tokenizes and normalizes seed keywords with limits", () => {
    const tokens = tokenizeSeedKeywords("AI productivity, cloud-tools cloud_tools SaaS!!!");
    expect(tokens).toEqual(["ai", "productivity", "cloud", "tools", "saas"]);
  });

  it("filters blacklist and dedupes terms during Datamuse expansion", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("ml=")) {
        return jsonResponse([
          { word: "scale", score: 800 },
          { word: "rapid", score: 700 },
          { word: "boost", score: 600 },
          { word: "rapid", score: 650 },
          { word: "the", score: 9999 },
        ]);
      }
      return jsonResponse([
        { word: "growth", score: 500 },
        { word: "Expand", score: 400 },
      ]);
    });

    const expanded = await expandWithDatamuse(["growth"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      blacklist: "boost",
      requestDelayMs: 0,
      requestJitterMs: 0,
    });

    const tokens = expanded.map((item) => item.token);
    expect(tokens).toContain("scale");
    expect(tokens).toContain("rapid");
    expect(tokens).toContain("expand");
    expect(tokens).not.toContain("boost");
    expect(tokens).not.toContain("the");
    expect(tokens.filter((token) => token === "rapid")).toHaveLength(1);
  });

  it("caps expansion size and keeps highest ranked entries", () => {
    const datamuse: ExpandedToken[] = [
      { token: "scale", source: "datamuse-ml", seed: "growth", score: 900 },
      { token: "optimize", source: "datamuse-ml", seed: "growth", score: 620 },
      { token: "accelerate", source: "datamuse-ml", seed: "growth", score: 860 },
    ];
    const wordnik: ExpandedToken[] = [
      { token: "boost", source: "wordnik", seed: "growth", score: 200, lexicalRelationStrong: false },
      { token: "surge", source: "wordnik", seed: "growth", score: 500, lexicalRelationStrong: true },
    ];

    const keywords = buildExpandedKeywordString(["growth"], datamuse, wordnik, {
      maxExpandedTerms: 2,
    });

    const tokens = keywords.split(/\s+/);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toBe("growth");
    expect(tokens[1]).toBe("scale");
    expect(tokens).not.toContain("optimize");
  });

  it("falls back to original keywords when enrichment times out", async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise(() => {
        // Intentionally unresolved promise to trigger timeout.
      });
      return jsonResponse([]);
    });

    const result = await enrichKeywords("ai productivity", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 15,
      requestDelayMs: 0,
      requestJitterMs: 0,
    });

    expect(result.expandedKeywords).toBe("ai productivity");
    expect(result.fallbackReason).toMatch(/timeout/i);
  });

  it("activates Wordnik enrichment when API key exists and applies POS filtering", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/relatedWords")) {
        return jsonResponse([
          { relationshipType: "synonym", words: ["velocity", "and"] },
          { relationshipType: "similar", words: ["fast"] },
        ]);
      }
      if (url.includes("/definitions")) {
        if (url.includes("velocity")) {
          return jsonResponse([{ partOfSpeech: "noun" }]);
        }
        return jsonResponse([{ partOfSpeech: "article" }]);
      }
      if (url.includes("/frequency")) {
        return jsonResponse({ totalCount: 42 });
      }
      return jsonResponse([]);
    });

    const expanded = await expandWithWordnik(["speed"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wordnikApiKey: "test-key",
      requestDelayMs: 0,
      requestJitterMs: 0,
    });

    expect(expanded.map((item) => item.token)).toContain("velocity");
    expect(expanded.map((item) => item.token)).not.toContain("fast");
  });

  it("allows strong lexical Wordnik terms to outrank weaker Datamuse terms", () => {
    const datamuse: ExpandedToken[] = [
      { token: "optimize", source: "datamuse-ml", seed: "speed", score: 120 },
    ];
    const wordnik: ExpandedToken[] = [
      { token: "velocity", source: "wordnik", seed: "speed", score: 160, lexicalRelationStrong: true },
    ];

    const tokens = buildExpandedKeywordString(["speed"], datamuse, wordnik, {
      maxExpandedTerms: 1,
    }).split(/\s+/);

    expect(tokens).toEqual(["speed", "velocity"]);
  });
});
