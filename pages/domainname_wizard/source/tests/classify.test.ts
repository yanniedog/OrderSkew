import { describe, expect, it } from "vitest";

import { classifyDomainResults } from "@/lib/search/classify";

describe("budget classification", () => {
  it("keeps only available within-budget domains", () => {
    const results = classifyDomainResults(
      [
        {
          domain: "alpha.com",
          sourceName: "Alpha",
          isNamelixPremium: false,
          available: true,
          definitive: true,
          priceMicros: 20_000_000,
          currency: "USD",
        },
        {
          domain: "beta.com",
          sourceName: "Beta",
          isNamelixPremium: true,
          available: true,
          definitive: true,
          priceMicros: 80_000_000,
          currency: "USD",
        },
        {
          domain: "gamma.com",
          sourceName: "Gamma",
          isNamelixPremium: false,
          available: false,
          definitive: false,
          reason: "taken",
        },
      ],
      50,
    );

    expect(results.withinBudget).toHaveLength(1);
    expect(results.overBudget).toHaveLength(0);
    expect(results.unavailable).toHaveLength(0);
    expect(results.allRanked).toHaveLength(1);

    expect(results.withinBudget[0]?.domain).toBe("alpha.com");
    expect(results.allRanked[0]?.domain).toBe("alpha.com");
  });

  it("sorts available results by lowest price first", () => {
    const results = classifyDomainResults(
      [
        {
          domain: "zeta.com",
          sourceName: "Zeta",
          isNamelixPremium: false,
          available: true,
          definitive: true,
          priceMicros: 30_000_000,
          currency: "USD",
        },
        {
          domain: "alpha.com",
          sourceName: "Alpha",
          isNamelixPremium: false,
          available: true,
          definitive: true,
          priceMicros: 10_000_000,
          currency: "USD",
        },
      ],
      50,
    );

    expect(results.withinBudget[0]?.domain).toBe("alpha.com");
    expect(results.withinBudget[1]?.domain).toBe("zeta.com");
  });
});

