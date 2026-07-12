/**
 * Polished, self-contained HTML report for `motionlint review` findings.
 * Embeds each viewport's screenshot inline (base64) so the report is a single
 * shareable file, and pairs every issue with a before → after (issue → fix) panel.
 */
import type { AnalysisEntry, ReviewReport, UXIssue, IssueSeverity } from "../types.js";
import { escapeHtml, htmlShell, scoreRing, severityPills } from "./html_shell.js";

const SEV_ORDER: Record<IssueSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };

function sortIssues(issues: UXIssue[]): UXIssue[] {
  return [...issues].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

function headline(report: ReviewReport): { title: string; blurb: string } {
  if (report.critical_count > 0) {
    return { title: "Critical issues need attention", blurb: "At least one finding blocks task completion or fails an accessibility standard." };
  }
  if (report.warning_count > 0) {
    return { title: "Usability warnings found", blurb: "No blockers, but several issues measurably degrade the experience." };
  }
  if (report.suggestion_count > 0) {
    return { title: "Looking good — a few polish notes", blurb: "Only nice-to-have refinements remain." };
  }
  return { title: "Clean bill of health", blurb: "No UI/UX issues were identified across the reviewed viewports." };
}

function renderIssue(issue: UXIssue, index: number): string {
  const delay = Math.min(index * 40, 320); // 40ms stagger, capped
  const ba = `
    <div class="ba">
      <div class="cell"><div class="cap">Current — the issue</div><div class="v" style="white-space:normal;font-family:inherit;font-size:13.5px">${escapeHtml(issue.issue)}</div></div>
      <div class="arrow">→</div>
      <div class="cell after"><div class="cap">Suggested fix</div><div class="v" style="white-space:normal;font-family:inherit;font-size:13.5px">${escapeHtml(issue.fix)}</div></div>
    </div>`;
  const idLine = issue.hash
    ? `<div class="std" style="background:var(--bg-sunken);color:var(--text-dim)">Finding id <code>${escapeHtml(issue.hash)}</code>${
        issue.previously_seen ? ` · seen in ${issue.previously_seen} prior run${issue.previously_seen === 1 ? "" : "s"}` : ""
      } — add to the baseline file to suppress.</div>`
    : "";
  return `
  <article class="finding sev-${issue.severity}" style="animation-delay:${delay}ms">
    <div class="top">
      <span class="badge">${escapeHtml(issue.severity)}</span>
      <span class="tag">${escapeHtml(issue.category)}</span>
      <h3>${escapeHtml(issue.issue)}</h3>
    </div>
    <p class="loc">📍 ${escapeHtml(issue.location || "unspecified location")}</p>
    <div class="field"><span class="lbl">Why it matters</span>${escapeHtml(issue.why_it_matters)}</div>
    ${ba}
    ${idLine}
  </article>`;
}

function renderViewport(entry: AnalysisEntry): string {
  const { capture, analysis } = entry;
  const shot = capture.screenshot?.length
    ? `<div class="shot"><img alt="${escapeHtml(capture.viewport.name)} screenshot" src="data:image/png;base64,${capture.screenshot.toString("base64")}"></div>`
    : "";
  const issues = analysis.issues.length
    ? sortIssues(analysis.issues).map(renderIssue).join("\n")
    : `<div class="empty"><div class="big">✓</div>No issues identified at this viewport.</div>`;
  const strengths = analysis.strengths.length
    ? `<div class="section-h"><h2>Strengths</h2></div><ul style="margin:0;padding-left:20px;color:var(--text-dim)">${analysis.strengths
        .map((s) => `<li>${escapeHtml(s)}</li>`)
        .join("")}</ul>`
    : "";
  return `
  <section>
    <div class="section-h">
      <h2>${escapeHtml(capture.viewport.name)}</h2>
      <span class="count">${capture.viewport.width}×${capture.viewport.height} · score ${analysis.overall_score}/10 · ${analysis.issues.length} issue${
        analysis.issues.length === 1 ? "" : "s"
      }</span>
    </div>
    ${analysis.summary ? `<p style="color:var(--text-dim);margin:0 0 4px">${escapeHtml(analysis.summary.replace(/\n+/g, " "))}</p>` : ""}
    ${shot}
    ${issues}
    ${strengths}
  </section>`;
}

export function renderReviewHtmlReport(report: ReviewReport): string {
  const h = headline(report);
  const summary = `
  <div class="summary">
    ${scoreRing(report.aggregate_score * 10)}
    <div class="headline">
      <h2>${escapeHtml(h.title)}</h2>
      <p>${escapeHtml(h.blurb)} · ${report.analyses.length} viewport${report.analyses.length === 1 ? "" : "s"} reviewed · aggregate ${report.aggregate_score}/10</p>
    </div>
    ${severityPills({ critical: report.critical_count, warning: report.warning_count, suggestion: report.suggestion_count })}
  </div>`;

  const body =
    report.analyses.length === 0
      ? `${summary}<div class="empty"><div class="big">∅</div>No analyses were produced.</div>`
      : `${summary}${report.analyses.map(renderViewport).join("\n")}`;

  return htmlShell({
    title: "MotionLint Design Review",
    subtitle: `<span class="mono">${escapeHtml(report.url)}</span> · ${escapeHtml(report.provider)} (${escapeHtml(
      report.model,
    )}) · ${escapeHtml(report.timestamp)}`,
    body,
  });
}
