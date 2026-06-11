import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const COMMITTED_DIR = "eval/results";
const SCRATCH_DIR = ".motionlint/test-samples";

/**
 * Directory where the test suite writes its sample artifacts
 * (sample-mock-eval.*, sample-tuner.html).
 *
 * Defaults to a gitignored scratch dir so `npm test` leaves the working tree
 * clean. Run with UPDATE_SAMPLES=1 to refresh the committed samples under
 * eval/results/ instead.
 */
export async function sampleOutDir(): Promise<string> {
  const flag = (process.env.UPDATE_SAMPLES ?? "").trim().toLowerCase();
  const update = flag !== "" && flag !== "0" && flag !== "false";
  const dir = resolve(update ? COMMITTED_DIR : SCRATCH_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}
