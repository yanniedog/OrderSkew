import { describe, expect, it } from "vitest";

import { scrapeNamelix } from "@/lib/namelix/scraper";
import type { SearchRequest } from "@/lib/types";

const minimalSearchRequest: SearchRequest = {
  keywords: "test",
  description: "",
  style: "default",
  randomness: "medium",
  blacklist: "",
  maxLength: 12,
  tld: "com",
  maxNames: 5,
  yearlyBudget: 50,
  loopCount: 1,
};

describe("Namelix scraper", () => {
  it("scrapes names without throwing (radio visibility fix)", async () => {
    const logos = await scrapeNamelix(minimalSearchRequest);
    expect(logos).toBeDefined();
    expect(Array.isArray(logos)).toBe(true);
    expect(logos.length).toBeGreaterThanOrEqual(1);
    expect(logos[0]).toHaveProperty("businessName");
  }, 200_000);
});
