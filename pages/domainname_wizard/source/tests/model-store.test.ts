import { readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { getOptimizerModelPath, loadOptimizerModelState, saveOptimizerModelState } from "@/lib/search/model-store";
import { createDefaultOptimizerModelState } from "@/lib/search/optimizer";

const modelPath = getOptimizerModelPath();

afterEach(async () => {
  await rm(modelPath, { force: true });
});

describe("optimizer model store", () => {
  it("persists and reloads model state", async () => {
    const model = createDefaultOptimizerModelState();
    model.runCount = 11;
    model.styleBandit.default.plays = 3;
    model.styleBandit.default.reward = 2.1;

    await saveOptimizerModelState(model);
    const loaded = await loadOptimizerModelState();

    expect(loaded.runCount).toBe(11);
    expect(loaded.styleBandit.default.plays).toBe(3);
    expect(loaded.styleBandit.default.reward).toBeCloseTo(2.1, 4);
  });

  it("falls back to defaults on invalid file", async () => {
    await writeFile(modelPath, "{not-json", "utf8");
    const loaded = await loadOptimizerModelState();

    expect(loaded.runCount).toBe(0);
    expect(loaded.version).toBe(1);
  });

  it("writes JSON payload atomically", async () => {
    const model = createDefaultOptimizerModelState();
    await saveOptimizerModelState(model);
    const content = await readFile(modelPath, "utf8");

    expect(() => JSON.parse(content)).not.toThrow();
  });
});
