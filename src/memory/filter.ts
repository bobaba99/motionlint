import type { AnalysisEntry, UXIssue } from "../types.js";
import { findingHash } from "./hash.js";
import { seenCount, type MemoryStore } from "./store.js";

export interface MemoryFilterOptions {
  analyses: AnalysisEntry[];
  /** The reviewed URL — memory is scoped per URL. */
  url: string;
  /** Finding hashes the human has permanently waved off. Always suppressed. */
  baseline: Set<string>;
  store: MemoryStore;
  /** Drop findings already recorded in prior runs (agents that only want deltas). */
  newOnly: boolean;
}

export interface MemoryFilterResult {
  analyses: AnalysisEntry[];
  by_baseline: number;
  by_memory: number;
}

/**
 * Annotates every finding with its cross-run hash and prior sighting count,
 * suppresses baselined findings, and — only in newOnly mode — drops
 * recurrences. Previously-seen findings are annotated rather than silently
 * dropped by default, so an unfixed issue never vanishes from a report.
 */
export function applyMemory(opts: MemoryFilterOptions): MemoryFilterResult {
  let byBaseline = 0;
  let byMemory = 0;

  const analyses = opts.analyses.map((entry) => {
    const kept: UXIssue[] = [];
    for (const issue of entry.analysis.issues) {
      const hash = findingHash(issue);
      if (opts.baseline.has(hash)) {
        byBaseline++;
        continue;
      }
      const previouslySeen = seenCount(opts.store, opts.url, hash);
      if (opts.newOnly && previouslySeen > 0) {
        byMemory++;
        continue;
      }
      kept.push({ ...issue, hash, previously_seen: previouslySeen });
    }
    return { ...entry, analysis: { ...entry.analysis, issues: kept } };
  });

  return { analyses, by_baseline: byBaseline, by_memory: byMemory };
}
