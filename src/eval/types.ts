import type { AnalysisResult, IssueCategory, IssueSeverity, UXIssue } from "../types.js";

export interface ExpectedIssue {
  /** Acceptable categories for this expected issue. The model can choose any. */
  categories: IssueCategory[];
  /** Minimum severity the model must assign for this to count as detected. */
  min_severity: IssueSeverity;
  /** Any of these keywords (case-insensitive substring match) must appear in `issue|location|fix|category`. */
  any_keywords: string[];
}

export interface FixtureLabel {
  name: string;
  /** Path served by the eval server, e.g. /eval/low-contrast-cta */
  url: string;
  /** Viewports the fixture is meant to be evaluated on. */
  viewports: string[];
  /** Plain-English description of the seeded fault. Never sent to the model. */
  label: string;
  /** Canonical UX concept for the report (e.g., "color-contrast WCAG AA"). */
  ux_concept?: string;
  expected_issues: ExpectedIssue[];
  /** Optional gates for control fixtures (clean pages). */
  max_critical_issues?: number;
  max_warning_issues?: number;
}

export interface EvalThresholds {
  /** Minimum overall recall to call the level "passing". 0..1 */
  min_recall: number;
  /** Maximum allowed control violations within the level. */
  max_control_violations: number;
}

export interface LevelDefinition {
  name: string;
  summary: string;
  thresholds: EvalThresholds;
  fixtures: FixtureLabel[];
}

export interface TruthFile {
  version: string;
  description?: string;
  terminology?: Record<string, string>;
  levels: LevelDefinition[];
}

export interface ExpectedIssueResult {
  expected: ExpectedIssue;
  matched_issue: UXIssue | null;
}

export interface FixtureScore {
  fixture: string;
  viewport: string;
  level: string;
  label: string;
  ux_concept?: string;
  detected: number;
  expected: number;
  recall: number;
  surprise_critical: number;
  surprise_warning: number;
  control_violation: boolean;
  per_expected: ExpectedIssueResult[];
  raw: AnalysisResult;
}

export interface LevelResult {
  level: string;
  summary: string;
  thresholds: EvalThresholds;
  fixtures: FixtureScore[];
  total_expected: number;
  total_detected: number;
  recall: number;
  control_violations: number;
  passing: boolean;
  /** Why the level failed, if it did. Human-readable. */
  failure_reason?: string;
}

/** Structured action item for downstream LLM coding tools. */
export interface NextAction {
  level: string;
  fixture: string;
  ux_concept?: string;
  category: IssueCategory;
  severity: IssueSeverity;
  description: string;
  /** What the test wanted the model to surface. */
  expected_signal: string;
  /** Suggested remediation phrased in design-systems / a11y terminology. */
  suggested_fix: string;
}

export interface EvalReport {
  generated_at: string;
  provider: string;
  model: string;
  truth_version: string;
  terminology?: Record<string, string>;
  levels: LevelResult[];
  /** Highest level that passed end-to-end (e.g., "L2-intermediate"). null if none passed. */
  highest_passing_level: string | null;
  /** First level that failed; null if all passed. */
  first_failing_level: string | null;
  overall_passing: boolean;
  next_actions: NextAction[];
}
