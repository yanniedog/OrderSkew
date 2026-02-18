import { describe, expect, it } from "vitest";

import { scoreDomainResult } from "@/lib/search/scoring";
import type { DomainResult, SearchRequest } from "@/lib/types";

const baseInput: SearchRequest = {
  keywords: "bright finance tools",
  description: "fast memorable fintech brand",
  style: "brandable",
  randomness: "medium",
  blacklist: "",
  maxLength: 16,
  tld: "com",
  maxNames: 50,
  yearlyBudget: 120,
  loopCount: 1,
};

function createResult(partial: Partial<DomainResult>): DomainResult {
  return {
    domain: "brightflow.com",
    sourceName: "Bright Flow",
    isNamelixPremium: false,
    available: true,
    definitive: true,
    currency: "USD",
    overBudget: false,
    ...partial,
  };
}

describe("scoring", () => {
  it("scores high quality available domains above unavailable expensive ones", () => {
    const strong = scoreDomainResult(
      createResult({ domain: "brightflow.com", price: 14, overBudget: false }),
      baseInput,
    );
    const weak = scoreDomainResult(
      createResult({
        domain: "x9-labs-now.com",
        available: false,
        definitive: false,
        price: 290,
        overBudget: true,
      }),
      baseInput,
    );

    expect(strong.overallScore).toBeGreaterThan(weak.overallScore);
    expect(strong.financialValueScore).toBeGreaterThan(weak.financialValueScore);
    expect(strong.marketabilityScore).toBeGreaterThan(weak.marketabilityScore);
  });

  it("produces interpretable driver and detractor components", () => {
    const scored = scoreDomainResult(
      createResult({ domain: "alpha-beta9.com", price: 60, overBudget: false }),
      baseInput,
    );

    expect(scored.valueDrivers.length).toBeGreaterThan(0);
    expect(scored.valueDetractors.length).toBeGreaterThan(0);
    expect(scored.valueDrivers[0]?.component).toBeTypeOf("string");
    expect(scored.valueDetractors[0]?.component).toBeTypeOf("string");
  });
});
