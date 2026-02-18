import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createDefaultOptimizerModelState,
  sanitizeOptimizerModelState,
  type OptimizerModelState,
} from "@/lib/search/optimizer";

const MODEL_DIR = path.join(process.cwd(), "data");
const MODEL_PATH = path.join(MODEL_DIR, "optimizer-state.json");
const TEMP_MODEL_PATH = path.join(MODEL_DIR, "optimizer-state.tmp.json");

export async function loadOptimizerModelState(): Promise<OptimizerModelState> {
  try {
    const raw = await readFile(MODEL_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeOptimizerModelState(parsed);
  } catch {
    return createDefaultOptimizerModelState();
  }
}

export async function saveOptimizerModelState(state: OptimizerModelState): Promise<void> {
  try {
    await mkdir(MODEL_DIR, { recursive: true });
    const payload = JSON.stringify(sanitizeOptimizerModelState(state), null, 2);
    await writeFile(TEMP_MODEL_PATH, payload, "utf8");
    await rename(TEMP_MODEL_PATH, MODEL_PATH);
  } catch {
    try {
      await rm(TEMP_MODEL_PATH, { force: true });
    } catch {
      // Ignore cleanup errors to keep job execution non-fatal.
    }
  }
}

export function getOptimizerModelPath(): string {
  return MODEL_PATH;
}
