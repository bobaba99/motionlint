import type { AnalysisResult, IssueCategory, IssueSeverity, UXIssue } from "../types.js";

const VALID_CATEGORIES: ReadonlySet<IssueCategory> = new Set([
  "hierarchy", "spacing", "alignment", "typography", "color", "contrast",
  "responsiveness", "interaction", "content", "navigation", "consistency", "loading_state",
]);

const VALID_SEVERITY: ReadonlySet<IssueSeverity> = new Set(["critical", "warning", "suggestion"]);

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
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
  return {
    category,
    severity,
    location,
    issue,
    why_it_matters: String(r.why_it_matters ?? "").trim(),
    fix: String(r.fix ?? "").trim(),
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
    return {
      overall_score: 0,
      summary: `Failed to parse model JSON: ${(err as Error).message}`,
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
