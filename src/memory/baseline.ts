import { readFile } from "node:fs/promises";

/**
 * Loads a baseline file (default: .motionlintignore) — one finding hash per
 * line. `#` starts a comment; anything after the first whitespace on a line
 * is treated as a free-form note. A missing file is an empty baseline.
 */
export async function loadBaseline(path: string): Promise<Set<string>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw new Error(`Failed to read baseline file ${path}: ${(err as Error).message}`);
  }
  const hashes = raw
    .split("\n")
    .map((line) => line.split("#")[0].trim().split(/\s+/)[0])
    .filter(Boolean);
  return new Set(hashes);
}
