import { describe, expect, it } from "vitest";

import {
  DomainSearchOptimizer,
  createDefaultOptimizerModelState,
} from "@/lib/search/optimizer";
import type { SearchRequest } from "@/lib/types";

const baseInput: SearchRequest = {
  keywords: "cloud backup secure",
  description: "reliable encrypted storage",
  style: "default",
  randomness: "medium",
  blacklist: "",
  maxLength: 16,
  tld: "com",
  maxNames: 40,
  yearlyBudget: 100,
  loopCount: 3,
};

describe("DomainSearchOptimizer", () => {
  it("produces deterministic loop plans for the same seed", () => {
    const model = createDefaultOptimizerModelState();
    const a = new DomainSearchOptimizer(baseInput, model, 1234);
    const b = new DomainSearchOptimizer(baseInput, model, 1234);

    const planA = a.nextLoop(1);
    const planB = b.nextLoop(1);

    expect(planA.selectedStyle).toBe(planB.selectedStyle);
    expect(planA.selectedRandomness).toBe(planB.selectedRandomness);
    expect(planA.selectedMutationIntensity).toBe(planB.selectedMutationIntensity);
    expect(planA.input.keywords).toBe(planB.input.keywords);
    expect(planA.input.description).toBe(planB.input.description);
  });

  it("updates selected bandit arms and reward totals", () => {
    const optimizer = new DomainSearchOptimizer(baseInput, createDefaultOptimizerModelState(), 77);
    const plan = optimizer.nextLoop(1);
    const tuningStep = optimizer.recordReward(plan, 0.9);
    const snapshot = optimizer.snapshotModelState();

    expect(tuningStep.reward).toBe(0.9);
    expect(snapshot.styleBandit[plan.selectedStyle].plays).toBe(1);
    expect(snapshot.styleBandit[plan.selectedStyle].reward).toBeCloseTo(0.9, 4);
    expect(snapshot.randomnessBandit[plan.selectedRandomness].plays).toBe(1);
    expect(snapshot.mutationBandit[plan.selectedMutationIntensity].plays).toBe(1);
  });
});
