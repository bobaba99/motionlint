import type { AnalysisEntry, ReviewReport, IssueSeverity } from "../types.js";

export function aggregate(
  url: string,
  provider: string,
  model: string,
  analyses: AnalysisEntry[],
): ReviewReport {
  const counts: Record<IssueSeverity, number> = { critical: 0, warning: 0, suggestion: 0 };
  let scoreSum = 0;
  let scoreN = 0;

  for (const entry of analyses) {
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
    analyses,
    aggregate_score: scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) / 10 : 0,
    critical_count: counts.critical,
    warning_count: counts.warning,
    suggestion_count: counts.suggestion,
  };
}
