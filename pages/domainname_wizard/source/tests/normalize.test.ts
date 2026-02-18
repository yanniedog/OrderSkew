import { describe, expect, it } from "vitest";

import {
  buildDomainFromBusinessName,
  normalizeBusinessNameKey,
  normalizeBusinessNameToLabel,
  normalizeTld,
} from "@/lib/domain/normalize";
import { buildDomainCandidates } from "@/lib/search/runner";
import type { SearchRequest } from "@/lib/types";

describe("domain normalization", () => {
  it("normalizes unicode and punctuation to dns-safe labels", () => {
    expect(normalizeBusinessNameToLabel(`Cre\u0301me & Co.`))?.toBe("creme-and-co");
  });

  it("rejects empty normalized labels", () => {
    expect(normalizeBusinessNameToLabel("!!!")).toBeNull();
  });

  it("builds fqdn with normalized tld", () => {
    expect(buildDomainFromBusinessName("Alpha Labs", ".COM")).toBe("alpha-labs.com");
  });

  it("normalizes key for dedupe", () => {
    expect(normalizeBusinessNameKey(`AC\u0327ME & Co`))?.toBe("acme and co");
  });

  it("rejects invalid tld", () => {
    expect(normalizeTld("***")).toBeNull();
  });

  it("filters generated labels that exceed maxLength", () => {
    const input: SearchRequest = {
      keywords: "alpha brand",
      description: "",
      style: "default",
      randomness: "medium",
      blacklist: "",
      maxLength: 8,
      tld: "com",
      maxNames: 10,
      yearlyBudget: 100,
      loopCount: 1,
    };

    const { candidates, invalid } = buildDomainCandidates(input, [
      { businessName: "Very Long Brand Name" },
      { businessName: "QuickFox" },
    ]);

    expect(candidates.map((item) => item.domain)).toEqual(["quickfox.com"]);
    expect(invalid[0]?.reason).toContain("exceeds maxLength");
  });
});

