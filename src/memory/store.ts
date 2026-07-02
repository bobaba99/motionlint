import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { UXIssue } from "../types.js";
import { findingHash } from "./hash.js";

export interface MemoryEntry {
  first_seen: string;
  last_seen: string;
  seen_count: number;
  category: string;
  location: string;
  issue: string;
}

/** Cross-run finding memory, keyed by reviewed URL, then by finding hash. */
export interface MemoryStore {
  version: 1;
  urls: Record<string, Record<string, MemoryEntry>>;
}

export function emptyStore(): MemoryStore {
  return { version: 1, urls: {} };
}

export async function loadMemory(path: string): Promise<MemoryStore> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw new Error(`Failed to read memory store ${path}: ${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw) as MemoryStore;
    if (parsed?.version !== 1 || typeof parsed.urls !== "object" || parsed.urls === null) {
      throw new Error("unrecognized shape");
    }
    return parsed;
  } catch (err) {
    throw new Error(`Memory store ${path} is corrupt (${(err as Error).message}). Delete it to start fresh.`);
  }
}

export function seenCount(store: MemoryStore, url: string, hash: string): number {
  return store.urls[url]?.[hash]?.seen_count ?? 0;
}

/**
 * Returns a new store with this run's findings recorded for `url` (the input
 * store is untouched). Each hash counts at most once per run, mirroring the
 * self-consistency rule of not double-counting within a single run.
 */
export function recordFindings(
  store: MemoryStore,
  url: string,
  issues: UXIssue[],
  timestamp: string,
): MemoryStore {
  const forUrl = { ...(store.urls[url] ?? {}) };
  const countedThisRun = new Set<string>();
  for (const issue of issues) {
    const hash = findingHash(issue);
    if (countedThisRun.has(hash)) continue;
    countedThisRun.add(hash);
    const prior = forUrl[hash];
    forUrl[hash] = prior
      ? { ...prior, last_seen: timestamp, seen_count: prior.seen_count + 1 }
      : {
          first_seen: timestamp,
          last_seen: timestamp,
          seen_count: 1,
          category: issue.category,
          location: issue.location,
          issue: issue.issue,
        };
  }
  return { ...store, urls: { ...store.urls, [url]: forUrl } };
}

/**
 * Plain read-modify-write with no cross-process locking: concurrent reviews of
 * the same project can clobber each other's recorded sightings. Deliberate —
 * locking is a fleet-scale concern, deferred with the PR-surface/resource caps.
 */
export async function saveMemory(path: string, store: MemoryStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), "utf8");
}
