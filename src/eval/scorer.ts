import type { AnalysisResult, IssueSeverity, UXIssue } from "../types.js";
import { categoriesAreCompatible, softKeywordMatch } from "./synonyms.js";
import type { ExpectedIssue, ExpectedIssueResult, FixtureLabel, FixtureScore } from "./types.js";

const SEVERITY_RANK: Record<IssueSeverity, number> = { suggestion: 0, warning: 1, critical: 2 };

function severityAtLeast(actual: IssueSeverity, min: IssueSeverity): boolean {
  return SEVERITY_RANK[actual] >= SEVERITY_RANK[min];
}

function textHaystack(issue: UXIssue): string {
  return `${issue.issue} ${issue.location} ${issue.fix} ${issue.why_it_matters} ${issue.category}`;
}

function issueMatchesExpected(issue: UXIssue, expected: ExpectedIssue): boolean {
  const categoryOk = expected.categories.some((c) => categoriesAreCompatible(issue.category, c));
  if (!categoryOk) return false;
  if (!severityAtLeast(issue.severity, expected.min_severity)) return false;
  return softKeywordMatch(textHaystack(issue), expected.any_keywords);
}

/**
 * Score one fixture × viewport pair against its labels.
 * Greedy match: each returned issue can satisfy at most one expected slot,
 * preferring stronger severity matches.
 *
 * Matching rules (G1+G3):
 *   - category compatibility uses the synonym graph (e.g., color ↔ contrast)
 *   - keyword matching is soft: substring OR token overlap (≥2 substantive tokens)
 */
export function scoreFixture(
  fixture: FixtureLabel,
  viewport: string,
  analysis: AnalysisResult,
  level: string = "",
): FixtureScore {
  const issues = [...analysis.issues].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const consumed = new Set<number>();
  const per_expected: ExpectedIssueResult[] = [];

  for (const expected of fixture.expected_issues) {
    let match: UXIssue | null = null;
    for (let i = 0; i < issues.length; i++) {
      if (consumed.has(i)) continue;
      if (issueMatchesExpected(issues[i], expected)) {
        match = issues[i];
        consumed.add(i);
        break;
      }
    }
    per_expected.push({ expected, matched_issue: match });
  }

  const detected = per_expected.filter((r) => r.matched_issue !== null).length;
  const expected = fixture.expected_issues.length;
  const recall = expected === 0 ? 1 : detected / expected;

  let surprise_critical = 0;
  let surprise_warning = 0;
  for (let i = 0; i < issues.length; i++) {
    if (consumed.has(i)) continue;
    if (issues[i].severity === "critical") surprise_critical++;
    else if (issues[i].severity === "warning") surprise_warning++;
  }

  const control_violation =
    (fixture.max_critical_issues !== undefined && surprise_critical > fixture.max_critical_issues) ||
    (fixture.max_warning_issues !== undefined && surprise_warning > fixture.max_warning_issues);

  return {
    fixture: fixture.name,
    viewport,
    level,
    label: fixture.label,
    ux_concept: fixture.ux_concept,
    detected,
    expected,
    recall,
    surprise_critical,
    surprise_warning,
    control_violation,
    per_expected,
    raw: analysis,
  };
}
