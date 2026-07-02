import { createHash } from "node:crypto";
import { issueClusterSignature } from "../eval/synonyms.js";
import type { UXIssue } from "../types.js";

function normalizeLocation(location: string): string {
  return location.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Stable cross-run identity for a finding: category + normalized issue text +
 * normalized location (the element selector/description). Reuses the same
 * token normalization as self-consistency clustering so cosmetic rephrasing
 * by the vision LLM does not change the hash. Severity is deliberately
 * excluded — the same finding reported at a different severity is the same
 * finding.
 */
export function findingHash(issue: UXIssue): string {
  const signature = issueClusterSignature(issue.category, issue.issue);
  const input = `${signature}::${normalizeLocation(issue.location)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
