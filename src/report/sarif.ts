import type { ReviewReport, IssueSeverity } from "../types.js";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA = "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json";

const SEVERITY_LEVEL: Record<IssueSeverity, "error" | "warning" | "note"> = {
  critical: "error",
  warning: "warning",
  suggestion: "note",
};

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };

export interface SarifRenderOptions {
  /**
   * PR-surface cap: emit at most N results, keeping the most severe (ties keep
   * their original order). Bounds how many annotations land on a PR when the
   * SARIF file is uploaded to code scanning. Non-positive or null = uncapped.
   */
  maxAnnotations?: number | null;
}

interface RankedResult {
  severity: IssueSeverity;
  result: Record<string, unknown>;
}

function capResults(ranked: RankedResult[], maxAnnotations: number | null | undefined): {
  results: Array<Record<string, unknown>>;
  dropped: number;
} {
  const capActive =
    typeof maxAnnotations === "number" && Number.isInteger(maxAnnotations) && maxAnnotations > 0;
  if (!capActive || ranked.length <= maxAnnotations) {
    return { results: ranked.map((r) => r.result), dropped: 0 };
  }
  // Stable sort: within a severity, earlier results (earlier viewport, then
  // earlier issue) win — mirrors the per-run cap in aggregate.ts.
  const kept = new Set(
    ranked
      .map((r, idx) => ({ idx, rank: SEVERITY_RANK[r.severity] }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, maxAnnotations)
      .map((r) => r.idx),
  );
  return {
    results: ranked.filter((_, idx) => kept.has(idx)).map((r) => r.result),
    dropped: ranked.length - kept.size,
  };
}

export function renderSarifReport(report: ReviewReport, opts: SarifRenderOptions = {}): string {
  const ranked: RankedResult[] = [];
  for (const entry of report.analyses) {
    const fileRef = entry.capture.screenshotPath ?? `${entry.capture.url}#${entry.capture.viewport.name}`;
    for (const issue of entry.analysis.issues) {
      ranked.push({
        severity: issue.severity,
        result: {
          ruleId: `${issue.category}/${issue.severity}`,
          level: SEVERITY_LEVEL[issue.severity],
          message: {
            text: `${issue.issue}\n\nWhy it matters: ${issue.why_it_matters}\n\nFix: ${issue.fix}`,
          },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: fileRef },
              region: { startLine: 1 },
            },
            logicalLocations: [{
              name: issue.location,
              kind: "uiElement",
            }],
          }],
          // Stable cross-run identity so SARIF consumers (e.g. GitHub code
          // scanning) can dedup the same finding across runs and PRs.
          ...(issue.hash ? { partialFingerprints: { "motionlintFinding/v1": issue.hash } } : {}),
          properties: {
            viewport: entry.capture.viewport.name,
            category: issue.category,
            ...(issue.previously_seen !== undefined ? { previously_seen: issue.previously_seen } : {}),
          },
        },
      });
    }
  }

  const { results, dropped } = capResults(ranked, opts.maxAnnotations);

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [{
      tool: {
        driver: {
          name: "motionlint",
          version: "0.1.0",
          informationUri: "https://github.com/bobaba99/motionlint",
          rules: [],
        },
      },
      results,
      properties: {
        url: report.url,
        provider: report.provider,
        model: report.model,
        aggregate_score: report.aggregate_score,
        ...(dropped > 0 ? { omitted_by_pr_cap: dropped } : {}),
      },
    }],
  };

  return JSON.stringify(sarif, null, 2);
}
