import { describe, expect, it } from "vitest";

import { sortRankedDomains } from "@/lib/search/sort";
import type { RankedDomainResult } from "@/lib/types";

function createRow(partial: Partial<RankedDomainResult>): RankedDomainResult {
  return {
    domain: "alpha.com",
    sourceName: "Alpha",
    isNamelixPremium: false,
    available: true,
    definitive: true,
    overBudget: false,
    marketabilityScore: 80,
    financialValueScore: 70,
    overallScore: 75,
    syllableCount: 3,
    labelLength: 5,
    valueDrivers: [],
    valueDetractors: [],
    firstSeenLoop: 1,
    lastSeenLoop: 1,
    timesDiscovered: 1,
    ...partial,
  };
}

describe("sortRankedDomains", () => {
  const rows: RankedDomainResult[] = [
    createRow({
      domain: "zeta.com",
      marketabilityScore: 88,
      financialValueScore: 75,
      overallScore: 81,
      syllableCount: 4,
      labelLength: 4,
    }),
    createRow({
      domain: "alpha.com",
      marketabilityScore: 72,
      financialValueScore: 94,
      overallScore: 86,
      syllableCount: 3,
      labelLength: 5,
    }),
    createRow({
      domain: "beta.com",
      marketabilityScore: 72,
      financialValueScore: 94,
      overallScore: 86,
      syllableCount: 2,
      labelLength: 4,
    }),
  ];

  it("sorts by marketability descending", () => {
    const sorted = sortRankedDomains(rows, "marketability");
    expect(sorted[0]?.domain).toBe("zeta.com");
  });

  it("sorts by financial value descending with stable tie-break", () => {
    const sorted = sortRankedDomains(rows, "financialValue");
    expect(sorted[0]?.domain).toBe("alpha.com");
    expect(sorted[1]?.domain).toBe("beta.com");
  });

  it("sorts alphabetically", () => {
    const sorted = sortRankedDomains(rows, "alphabetical");
    expect(sorted.map((row) => row.domain)).toEqual(["alpha.com", "beta.com", "zeta.com"]);
  });

  it("sorts by syllable count ascending", () => {
    const sorted = sortRankedDomains(rows, "syllableCount");
    expect(sorted[0]?.domain).toBe("beta.com");
  });

  it("sorts by label length ascending", () => {
    const sorted = sortRankedDomains(rows, "labelLength");
    expect(sorted[0]?.domain).toBe("beta.com");
  });
});
