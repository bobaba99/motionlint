import kleur from "kleur";
import type { ReviewReport, IssueSeverity } from "../types.js";
import { formatUsageLine } from "../resources/usage.js";

export function severityColor(s: IssueSeverity, text: string): string {
  switch (s) {
    case "critical": return kleur.red().bold(text);
    case "warning":  return kleur.yellow(text);
    case "suggestion": return kleur.cyan(text);
  }
}

export function summarize(report: ReviewReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(kleur.bold().white(`MotionLint Report — ${report.url}`));
  lines.push(kleur.gray(`provider: ${report.provider} (${report.model})`));
  lines.push(kleur.gray(`generated: ${report.timestamp}`));
  lines.push("");
  lines.push(`Score: ${kleur.bold(`${report.aggregate_score}/10`)}`);
  lines.push(
    `Issues: ${severityColor("critical", `${report.critical_count} critical`)} · ` +
    `${severityColor("warning", `${report.warning_count} warning`)} · ` +
    `${severityColor("suggestion", `${report.suggestion_count} suggestion`)}`,
  );
  const omittedParts = [
    report.omitted.by_cap > 0 ? `${report.omitted.by_cap} over the output cap` : null,
    report.omitted.by_baseline > 0 ? `${report.omitted.by_baseline} baselined` : null,
    report.omitted.by_memory > 0 ? `${report.omitted.by_memory} previously seen` : null,
  ].filter(Boolean);
  if (omittedParts.length > 0) {
    lines.push(kleur.dim(`Omitted: ${omittedParts.join(" · ")}`));
  }
  if (report.usage && report.usage.total_tokens > 0) {
    lines.push(kleur.dim(`Tokens: ${formatUsageLine(report.usage)}`));
  }
  lines.push("");

  for (const entry of report.analyses) {
    lines.push(kleur.bold().underline(`[${entry.capture.viewport.name}] ${entry.capture.viewport.width}×${entry.capture.viewport.height}`));
    lines.push(kleur.dim(entry.analysis.summary));
    if (entry.capture.screenshotPath) lines.push(kleur.dim(`screenshot: ${entry.capture.screenshotPath}`));
    if (entry.capture.videoPath) lines.push(kleur.dim(`video: ${entry.capture.videoPath}`));
    lines.push("");
    if (entry.analysis.issues.length === 0) {
      lines.push(kleur.green("  No issues."));
    } else {
      const sorted = [...entry.analysis.issues].sort((a, b) => {
        const order: Record<IssueSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };
        return order[a.severity] - order[b.severity];
      });
      for (const issue of sorted) {
        lines.push(`  ${severityColor(issue.severity, `[${issue.severity}]`)} ${kleur.bold(issue.category)} — ${issue.location}`);
        lines.push(`    ${issue.issue}`);
        lines.push(kleur.dim(`    why: ${issue.why_it_matters}`));
        lines.push(kleur.green(`    fix: ${issue.fix}`));
        if (issue.hash) {
          const seen = issue.previously_seen && issue.previously_seen > 0
            ? ` · seen in ${issue.previously_seen} prior run${issue.previously_seen === 1 ? "" : "s"}`
            : "";
          lines.push(kleur.dim(`    id: ${issue.hash}${seen}`));
        }
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}
