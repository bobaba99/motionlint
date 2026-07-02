import { canonicalTokens, categoriesAreCompatible } from "../eval/synonyms.js";
import type { IssueCategory } from "../types.js";

export interface MatchCandidate {
  category: string;
  location: string;
  issue: string;
}

/**
 * Thresholds calibrated on real cross-run recurrence data (16 live findings,
 * 4 true duplicate pairs): 4+ shared canonical tokens covering at least half
 * of the smaller finding matched every true pair with zero false positives.
 */
const MIN_SHARED_TOKENS = 4;
const MIN_SHARED_FRACTION = 0.5;

/**
 * Fuzzy cross-run identity for findings. Exact hashes under-match on live
 * vision-LLM output — the model rewords location and issue text every run —
 * so recurrence detection additionally compares category compatibility (via
 * the eval synonym graph) and canonical-token overlap across location + text.
 */
export function findingsMatch(a: MatchCandidate, b: MatchCandidate): boolean {
  const catA = a.category as IssueCategory;
  const catB = b.category as IssueCategory;
  if (!categoriesAreCompatible(catA, catB) && !categoriesAreCompatible(catB, catA)) {
    return false;
  }
  const tokensA = canonicalTokens(`${a.location} ${a.issue}`);
  const tokensB = canonicalTokens(`${b.location} ${b.issue}`);
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared++;
  const smaller = Math.min(tokensA.size, tokensB.size);
  return shared >= MIN_SHARED_TOKENS && shared >= smaller * MIN_SHARED_FRACTION;
}
