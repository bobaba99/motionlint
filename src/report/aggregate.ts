import type { AnalysisEntry, ReviewReport, IssueSeverity } from "../types.js";

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };

export interface AggregateOptions {
  /** Keep only the top N findings across all viewports, severity-ordered. Non-positive or null = uncapped. */
  maxFindings?: number | null;
  /** Omission counts from upstream filters (baseline / memory), carried into the report. */
  omitted?: { by_baseline?: number; by_memory?: number };
}

/**
 * Per-run output cap: keeps the top `maxFindings` issues by severity across all
 * entries. Ties within a severity keep their original order (earlier viewport,
 * then earlier issue), so the surviving set is deterministic.
 */
function capBySeverity(
  analyses: AnalysisEntry[],
  maxFindings: number,
): { analyses: AnalysisEntry[]; dropped: number } {
  const indexed = analyses.flatMap((entry, entryIdx) =>
    entry.analysis.issues.map((issue, issueIdx) => ({ entryIdx, issueIdx, severity: issue.severity })),
  );
  if (indexed.length <= maxFindings) return { analyses, dropped: 0 };

  const kept = new Set(
    [...indexed]
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
      .slice(0, maxFindings)
      .map((i) => `${i.entryIdx}:${i.issueIdx}`),
  );
  return {
    dropped: indexed.length - maxFindings,
    analyses: analyses.map((entry, entryIdx) => ({
      ...entry,
      analysis: {
        ...entry.analysis,
        issues: entry.analysis.issues.filter((_, issueIdx) => kept.has(`${entryIdx}:${issueIdx}`)),
      },
    })),
  };
}

export function aggregate(
  url: string,
  provider: string,
  model: string,
  analyses: AnalysisEntry[],
  opts: AggregateOptions = {},
): ReviewReport {
  const capActive = typeof opts.maxFindings === "number" && Number.isInteger(opts.maxFindings) && opts.maxFindings > 0;
  const capped = capActive
    ? capBySeverity(analyses, opts.maxFindings as number)
    : { analyses, dropped: 0 };

  const counts: Record<IssueSeverity, number> = { critical: 0, warning: 0, suggestion: 0 };
  let scoreSum = 0;
  let scoreN = 0;

  for (const entry of capped.analyses) {
    for (const issue of entry.analysis.issues) counts[issue.severity]++;
    if (entry.analysis.overall_score > 0) {
      scoreSum += entry.analysis.overall_score;
      scoreN++;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    url,
    provider,
    model,
    analyses: capped.analyses,
    aggregate_score: scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) / 10 : 0,
    critical_count: counts.critical,
    warning_count: counts.warning,
    suggestion_count: counts.suggestion,
    omitted: {
      by_cap: capped.dropped,
      by_baseline: opts.omitted?.by_baseline ?? 0,
      by_memory: opts.omitted?.by_memory ?? 0,
    },
  };
}
