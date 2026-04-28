import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader. Loads KEY=value lines from a file into process.env
 * **without** overwriting variables already set in the real environment.
 * Quoted values (single or double) are unquoted; lines starting with # are skipped.
 *
 * Resolution order — first existing file wins:
 *   1. MOTIONLINT_ENV_FILE (if set)
 *   2. <cwd>/.env.local
 *   3. <cwd>/.env
 */
export function loadEnv(cwd: string = process.cwd()): string | null {
  const candidates = [
    process.env.MOTIONLINT_ENV_FILE,
    resolve(cwd, ".env.local"),
    resolve(cwd, ".env"),
  ].filter((p): p is string => Boolean(p));

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (!match) continue;
      const [, key] = match;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // export prefix (export KEY=value)
      const cleanKey = key.replace(/^export\s+/, "");
      if (process.env[cleanKey] === undefined) {
        process.env[cleanKey] = value;
      }
    }
    return file;
  }
  return null;
}
