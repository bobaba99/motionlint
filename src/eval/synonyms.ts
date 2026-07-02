import type { IssueCategory } from "../types.js";

/**
 * Bidirectional synonym graph between UX categories.
 * If the truth file expects {color, contrast} and the model returned {contrast},
 * either should count. Likewise, "responsiveness" issues may show up as "interaction"
 * (tap targets too small) or "spacing" (overflow).
 */
const CATEGORY_SYNONYMS: Array<IssueCategory[]> = [
  ["color", "contrast"],
  ["interaction", "consistency"],
  ["responsiveness", "spacing"],
  ["responsiveness", "interaction"],
  ["loading_state", "interaction"],
  ["loading_state", "content"],
  ["hierarchy", "typography"],
  ["alignment", "spacing"],
  ["alignment", "consistency"],
  ["navigation", "interaction"],
  ["navigation", "content"],
  ["content", "interaction"],
];

const categorySynonymMap: Map<IssueCategory, Set<IssueCategory>> = (() => {
  const m = new Map<IssueCategory, Set<IssueCategory>>();
  for (const group of CATEGORY_SYNONYMS) {
    for (const a of group) {
      const set = m.get(a) ?? new Set<IssueCategory>([a]);
      for (const b of group) set.add(b);
      m.set(a, set);
    }
  }
  return m;
})();

export function categoriesAreCompatible(actual: IssueCategory, expected: IssueCategory): boolean {
  if (actual === expected) return true;
  return categorySynonymMap.get(expected)?.has(actual) ?? false;
}

export function expandCategorySet(cats: IssueCategory[]): Set<IssueCategory> {
  const out = new Set<IssueCategory>();
  for (const c of cats) {
    out.add(c);
    const syn = categorySynonymMap.get(c);
    if (syn) for (const s of syn) out.add(s);
  }
  return out;
}

/**
 * Token-level synonyms. Models often substitute everyday words for the canonical
 * UX vocabulary; this small dictionary normalizes the most common swaps so
 * keyword matching doesn't fail on cosmetic differences.
 */
const TOKEN_SYNONYMS: Record<string, string> = {
  // touch / pointer events
  tap: "tap", taps: "tap", tapping: "tap",
  touch: "tap", touches: "tap",
  press: "tap", presses: "tap", pressing: "tap",
  click: "tap", clicks: "tap", clicking: "tap",
  // copy / labels
  label: "label", labels: "label", labeled: "label", labelled: "label",
  copy: "label",
  text: "label",
  microcopy: "label",
  wording: "label",
  // contrast / color
  contrast: "contrast", contrasts: "contrast",
  legibility: "contrast", legible: "contrast",
  readability: "readable", readable: "readable",
  // sizes
  small: "small", tiny: "small", undersized: "small", micro: "small", minimal: "small",
  large: "large", huge: "large", oversized: "large",
  // spacing
  spacing: "spacing", padding: "spacing", margin: "spacing", gap: "spacing", whitespace: "spacing", breathing: "spacing", cramped: "spacing", tight: "spacing",
  // hierarchy
  hierarchy: "hierarchy", scale: "hierarchy", structure: "hierarchy", ordering: "hierarchy",
  // overflow / responsive
  overflow: "overflow", overflows: "overflow", overlap: "overflow", overlaps: "overflow", overlapping: "overflow", obscure: "overflow", obscures: "overflow", obscured: "overflow", cover: "overflow", covers: "overflow", covering: "overflow", covered: "overflow", clip: "overflow", clipped: "overflow",
  scroll: "overflow", scrolling: "overflow", scrolls: "overflow",
  // loading
  loading: "loading", loader: "loading", spinner: "loading", skeleton: "loading", progress: "loading",
  // emptiness
  empty: "empty", blank: "empty", placeholder: "empty",
  // states / feedback
  state: "state", states: "state", feedback: "state",
  disabled: "disabled", inactive: "disabled", greyed: "disabled", grayed: "disabled",
  // affordance
  affordance: "affordance", affordances: "affordance",
  // buttons / cta
  button: "button", buttons: "button", btn: "button",
  cta: "cta", call: "cta", action: "cta",
};

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with",
  "is", "are", "was", "were", "be", "been", "as", "by", "this", "that", "it", "its",
  "from", "into", "than", "then", "so", "such", "some", "any", "all", "no", "not",
  "you", "your", "they", "them", "their", "i", "we", "us", "our",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function canonicalize(tokens: string[]): string[] {
  return tokens.map((t) => TOKEN_SYNONYMS[t] ?? t);
}

function hasSubstantiveToken(s: string): boolean {
  return tokenize(s).length > 0;
}

/**
 * Soft keyword match.
 *
 * Returns true if any of the expected keywords matches the haystack via either:
 *   1. Substring match (the keyword appears literally — but only if it has at
 *      least one substantive (non-stopword, >=3 char) token, so that "the and"
 *      doesn't trivially match every English sentence).
 *   2. Canonicalized token overlap: tokens are filtered for stopwords and mapped
 *      through a small synonym table (tap↔touch, label↔copy, etc.), then
 *      compared as sets. >=2 overlap, or >=1 overlap when the keyword is a
 *      single token, counts as a match.
 */
export function softKeywordMatch(haystack: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = haystack.toLowerCase();

  for (const k of keywords) {
    if (!hasSubstantiveToken(k)) continue;
    if (hay.includes(k.toLowerCase())) return true;
  }

  const hayTokens = new Set(canonicalize(tokenize(haystack)));
  for (const k of keywords) {
    const kTokens = canonicalize(tokenize(k));
    if (kTokens.length === 0) continue;
    let overlap = 0;
    for (const t of kTokens) if (hayTokens.has(t)) overlap++;
    if (overlap >= 2 || (kTokens.length === 1 && overlap === 1)) return true;
  }
  return false;
}

/** Cluster signature for self-consistency merging — order-independent, stopword-safe. */
export function issueClusterSignature(category: string, issueText: string): string {
  const tokens = canonicalize(tokenize(issueText)).slice(0, 3).sort();
  return `${category}::${tokens.join(" ")}`;
}

/** Stopword-filtered, synonym-canonicalized token set — the shared vocabulary for fuzzy matching. */
export function canonicalTokens(s: string): Set<string> {
  return new Set(canonicalize(tokenize(s)));
}
