import { describe, expect, it, vi } from "vitest";

import { prepareSearchPayloadWithKeywordEnrichment } from "@/lib/keywords/submit";
import type { KeywordEnrichmentResult } from "@/lib/keywords/enrichment";

const baseForm = {
  keywords: "ai productivity",
  description: "assistant tooling",
  style: "default" as const,
  randomness: "medium" as const,
  blacklist: "",
  maxLength: 16,
  tld: "com",
  maxNames: 100,
  yearlyBudget: 80,
  loopCount: 5,
};

function buildEnrichment(partial: Partial<KeywordEnrichmentResult>): KeywordEnrichmentResult {
  return {
    originalKeywords: baseForm.keywords,
    expandedKeywords: "ai productivity automation workflow",
    usedDatamuse: true,
    usedWordnik: false,
    debug: {
      seedTokens: ["ai", "productivity"],
      selectedRelated: ["automation", "workflow"],
      rejected: [],
    },
    ...partial,
  };
}

describe("keyword submit payload", () => {
  it("uses enriched keywords when enrichment succeeds", async () => {
    const enrichFn = vi.fn(async () => buildEnrichment({}));
    const { payload, enrichment } = await prepareSearchPayloadWithKeywordEnrichment(baseForm, {
      env: { NODE_ENV: "development", NEXT_PUBLIC_ENABLE_KEYWORD_ENRICHMENT: "1" },
      enrichFn,
    });

    expect(payload.keywords).toBe("ai productivity automation workflow");
    expect(enrichment?.usedDatamuse).toBe(true);
    expect(enrichFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to original keywords when enrichment fails", async () => {
    const enrichFn = vi.fn(async () => {
      throw new Error("network failed");
    });

    const { payload } = await prepareSearchPayloadWithKeywordEnrichment(baseForm, {
      env: { NODE_ENV: "development", NEXT_PUBLIC_ENABLE_KEYWORD_ENRICHMENT: "1" },
      enrichFn,
    });

    expect(payload.keywords).toBe(baseForm.keywords);
  });

  it("passes Wordnik key when available in env", async () => {
    const enrichFn = vi.fn(async () => buildEnrichment({ usedWordnik: true }));
    await prepareSearchPayloadWithKeywordEnrichment(baseForm, {
      env: {
        NODE_ENV: "development",
        NEXT_PUBLIC_ENABLE_KEYWORD_ENRICHMENT: "1",
        NEXT_PUBLIC_WORDNIK_API_KEY: "abc123",
      },
      enrichFn,
    });

    expect(enrichFn).toHaveBeenCalledWith(
      baseForm.keywords,
      expect.objectContaining({
        wordnikApiKey: "abc123",
      }),
    );
  });
});
