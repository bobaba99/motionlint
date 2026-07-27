import type { AnalysisResult, IssueCategory, IssueSeverity, UXIssue } from "../types.js";

const VALID_CATEGORIES: ReadonlySet<IssueCategory> = new Set([
  "hierarchy", "spacing", "alignment", "typography", "color", "contrast",
  "responsiveness", "interaction", "content", "navigation", "consistency", "loading_state",
]);

const VALID_SEVERITY: ReadonlySet<IssueSeverity> = new Set(["critical", "warning", "suggestion"]);

/**
 * Walk from the first `{` to its matching `}`, tracking string state and escapes.
 *
 * This is the only extraction strategy that survives a model embedding a fenced
 * code block inside a string value (a ```css snippet in `fix`, say): brace and
 * backtick characters inside a JSON string are skipped rather than treated as
 * structure. Regex-based extraction cannot do this.
 */
function scanBalancedObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }

  return null;
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();

  // Try each strategy and keep the first that actually parses, rather than
  // committing to whichever matched first. The old code returned the non-greedy
  // fence match unconditionally, so a nested fence truncated the payload
  // mid-string and the whole review was discarded as "no issues found".
  const candidates: string[] = [];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  const balanced = scanBalancedObject(trimmed);
  if (balanced) candidates.push(balanced);

  if (trimmed.startsWith("{")) candidates.push(trimmed);

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Fall through to the next strategy.
    }
  }

  // Nothing parsed. Hand back the best-effort candidate so the caller's error
  // message quotes something recognisable instead of null.
  return candidates[0] ?? null;
}

function coerceIssue(raw: unknown): UXIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const category = String(r.category ?? "").toLowerCase() as IssueCategory;
  const severity = String(r.severity ?? "").toLowerCase() as IssueSeverity;
  if (!VALID_CATEGORIES.has(category)) return null;
  if (!VALID_SEVERITY.has(severity)) return null;
  const location = String(r.location ?? "").trim();
  const issue = String(r.issue ?? "").trim();
  if (!issue) return null;
  const rawRef = String(r.element_ref ?? "").trim().toUpperCase();
  const element_ref = /^E\d{1,3}$/.test(rawRef) ? rawRef : undefined;
  return {
    category,
    severity,
    location,
    issue,
    why_it_matters: String(r.why_it_matters ?? "").trim(),
    fix: String(r.fix ?? "").trim(),
    ...(element_ref ? { element_ref } : {}),
  };
}

export function parseAnalysisResponse(raw: string, fallbackViewport: string): AnalysisResult {
  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    return {
      overall_score: 0,
      summary: `Model did not return valid JSON. Raw response (truncated): ${raw.slice(0, 400)}`,
      issues: [],
      strengths: [],
      viewport: fallbackViewport,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch (err) {
    // Quote the raw response too. Without it a parse failure is undebuggable
    // after the fact — the 2026-07-27 benchmark lost four fixtures to a bug that
    // took a synthetic repro to identify because only the error text survived.
    return {
      overall_score: 0,
      summary: `Failed to parse model JSON: ${(err as Error).message}. Raw response (truncated): ${raw.slice(0, 400)}`,
      issues: [],
      strengths: [],
      viewport: fallbackViewport,
    };
  }

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map(coerceIssue).filter((x): x is UXIssue => x !== null)
    : [];

  const strengths = Array.isArray(parsed.strengths)
    ? parsed.strengths.map((s) => String(s)).filter(Boolean)
    : [];

  const score = Number(parsed.overall_score);
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : 0;

  return {
    overall_score: safeScore,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    issues,
    strengths,
    viewport: typeof parsed.viewport === "string" && parsed.viewport ? parsed.viewport : fallbackViewport,
  };
}
