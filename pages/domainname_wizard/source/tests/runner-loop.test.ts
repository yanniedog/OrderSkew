import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJob, getJob } from "@/lib/jobs/store";
import { runSearchJob } from "@/lib/search/runner";
import type { GoDaddyAvailability } from "@/lib/godaddy/client";
import type { NamelixLogo } from "@/lib/types";

const {
  scrapeNamelixMock,
  checkAvailabilityBulkMock,
  loadOptimizerModelStateMock,
  saveOptimizerModelStateMock,
} = vi.hoisted(() => ({
  scrapeNamelixMock: vi.fn<() => Promise<NamelixLogo[]>>(),
  checkAvailabilityBulkMock: vi.fn<(domains: string[]) => Promise<Map<string, GoDaddyAvailability>>>(),
  loadOptimizerModelStateMock: vi.fn(),
  saveOptimizerModelStateMock: vi.fn(),
}));

vi.mock("@/lib/namelix/scraper", async () => {
  const actual = await vi.importActual<typeof import("@/lib/namelix/scraper")>("@/lib/namelix/scraper");
  return {
    ...actual,
    scrapeNamelix: scrapeNamelixMock,
  };
});

vi.mock("@/lib/godaddy/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/godaddy/client")>("@/lib/godaddy/client");
  return {
    ...actual,
    checkAvailabilityBulk: checkAvailabilityBulkMock,
  };
});

vi.mock("@/lib/search/model-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/search/model-store")>("@/lib/search/model-store");
  return {
    ...actual,
    loadOptimizerModelState: loadOptimizerModelStateMock,
    saveOptimizerModelState: saveOptimizerModelStateMock,
  };
});

function createModelState() {
  return {
    version: 1,
    runCount: 0,
    updatedAt: Date.now(),
    styleBandit: {
      default: { plays: 0, reward: 0 },
      brandable: { plays: 0, reward: 0 },
      twowords: { plays: 0, reward: 0 },
      threewords: { plays: 0, reward: 0 },
      compound: { plays: 0, reward: 0 },
      spelling: { plays: 0, reward: 0 },
      nonenglish: { plays: 0, reward: 0 },
      dictionary: { plays: 0, reward: 0 },
    },
    randomnessBandit: {
      low: { plays: 0, reward: 0 },
      medium: { plays: 0, reward: 0 },
      high: { plays: 0, reward: 0 },
    },
    mutationBandit: {
      low: { plays: 0, reward: 0 },
      medium: { plays: 0, reward: 0 },
      high: { plays: 0, reward: 0 },
    },
    tokenStats: {},
  };
}

beforeEach(() => {
  scrapeNamelixMock.mockReset();
  checkAvailabilityBulkMock.mockReset();
  loadOptimizerModelStateMock.mockReset();
  saveOptimizerModelStateMock.mockReset();
  loadOptimizerModelStateMock.mockResolvedValue(createModelState());
  saveOptimizerModelStateMock.mockResolvedValue(undefined);
});

describe("runSearchJob looped aggregation", () => {
  it("keeps only available domains and fills quota by iterating batches in each loop", async () => {
    let scrapeCall = 0;
    scrapeNamelixMock.mockImplementation(async () => {
      scrapeCall += 1;
      if (scrapeCall % 2 === 1) {
        return [{ businessName: "Nova" }, { businessName: "Pix" }];
      }

      return [{ businessName: "Quik" }, { businessName: "Zinc" }];
    });

    checkAvailabilityBulkMock.mockImplementation(async (domains) => {
      const map = new Map<string, GoDaddyAvailability>();
      for (const domain of domains) {
        const available = domain === "nova.com" || domain === "quik.com";
        map.set(domain, {
          domain,
          available,
          definitive: true,
          priceMicros: available ? 12_000_000 : undefined,
          currency: available ? "USD" : undefined,
          period: 1,
          reason: available ? undefined : "taken",
        });
      }

      return map;
    });

    const job = createJob({
      keywords: "speed tools",
      description: "memorable names",
      style: "default",
      randomness: "medium",
      blacklist: "",
      maxLength: 8,
      tld: "com",
      maxNames: 2,
      yearlyBudget: 50,
      loopCount: 2,
    });

    await runSearchJob(job.id);
    const finished = getJob(job.id);

    expect(finished?.status).toBe("done");
    expect(finished?.results?.allRanked.every((row) => row.available)).toBe(true);
    expect(finished?.results?.allRanked.every((row) => !row.overBudget)).toBe(true);
    expect(finished?.results?.overBudget).toHaveLength(0);
    expect(finished?.results?.unavailable).toHaveLength(0);
    expect(finished?.results?.loopSummaries).toHaveLength(2);

    for (const summary of finished?.results?.loopSummaries ?? []) {
      expect(summary.requiredQuota).toBe(2);
      expect(summary.availableCount).toBe(2);
      expect(summary.quotaMet).toBe(true);
      expect(summary.limitHit).toBe(false);
    }
  });

  it("does not count overbudget domains toward quota", async () => {
    let scrapeCall = 0;
    scrapeNamelixMock.mockImplementation(async () => {
      scrapeCall += 1;
      if (scrapeCall === 1) {
        return [{ businessName: "Expenso" }];
      }

      return [{ businessName: "Budgetly" }];
    });

    checkAvailabilityBulkMock.mockImplementation(async (domains) => {
      const map = new Map<string, GoDaddyAvailability>();
      for (const domain of domains) {
        if (domain === "expenso.com") {
          map.set(domain, {
            domain,
            available: true,
            definitive: true,
            priceMicros: 200_000_000,
            currency: "USD",
            period: 1,
          });
          continue;
        }

        map.set(domain, {
          domain,
          available: true,
          definitive: true,
          priceMicros: 20_000_000,
          currency: "USD",
          period: 1,
        });
      }

      return map;
    });

    const job = createJob({
      keywords: "budget planner",
      description: "pricing app",
      style: "default",
      randomness: "medium",
      blacklist: "",
      maxLength: 12,
      tld: "com",
      maxNames: 1,
      yearlyBudget: 50,
      loopCount: 1,
    });

    await runSearchJob(job.id);
    const finished = getJob(job.id);
    const summary = finished?.results?.loopSummaries[0];

    expect(finished?.status).toBe("done");
    expect(summary?.quotaMet).toBe(true);
    expect(summary?.availableCount).toBe(1);
    expect(summary?.consideredCount).toBeGreaterThanOrEqual(2);
    expect(finished?.results?.allRanked).toHaveLength(1);
    expect(finished?.results?.allRanked[0]?.domain).toBe("budgetly.com");
    expect(finished?.results?.overBudget).toHaveLength(0);
  });

  it("flags limit hit at 251 considered names but keeps partial available results", async () => {
    let scrapeCall = 0;
    scrapeNamelixMock.mockImplementation(async () => {
      scrapeCall += 1;
      if (scrapeCall === 1) {
        return Array.from({ length: 250 }, (_, index) => ({
          businessName: `brand${index}`,
        }));
      }

      return [{ businessName: "brand250" }, { businessName: "brand251" }];
    });

    checkAvailabilityBulkMock.mockImplementation(async (domains) => {
      const map = new Map<string, GoDaddyAvailability>();
      for (const domain of domains) {
        const matched = domain.match(/^brand(\d+)\.com$/);
        const index = matched ? Number(matched[1]) : -1;
        const available = index >= 0 && index < 10;

        map.set(domain, {
          domain,
          available,
          definitive: true,
          priceMicros: available ? 15_000_000 : undefined,
          currency: available ? "USD" : undefined,
          period: 1,
          reason: available ? undefined : "taken",
        });
      }

      return map;
    });

    const job = createJob({
      keywords: "brand",
      description: "high volume",
      style: "default",
      randomness: "medium",
      blacklist: "",
      maxLength: 12,
      tld: "com",
      maxNames: 250,
      yearlyBudget: 100,
      loopCount: 1,
    });

    await runSearchJob(job.id);
    const finished = getJob(job.id);
    const summary = finished?.results?.loopSummaries[0];

    expect(finished?.status).toBe("done");
    expect(summary?.limitHit).toBe(true);
    expect(summary?.quotaMet).toBe(false);
    expect(summary?.availableCount).toBeGreaterThan(0);
    expect(summary?.skipReason).toContain("251");
    expect(finished?.results?.allRanked.length).toBe(summary?.availableCount ?? 0);
    expect(finished?.results?.allRanked.every((row) => row.available)).toBe(true);
  });
});
