import { readFile } from "node:fs/promises";

export async function loadRules(rulesPath: string | null | undefined): Promise<string | null> {
  if (!rulesPath) return null;
  try {
    return (await readFile(rulesPath, "utf8")).trim();
  } catch {
    return null;
  }
}
