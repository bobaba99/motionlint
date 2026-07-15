import { isAbsolute, relative } from "node:path";
import type { FlowReport } from "./types.js";
import type { IssueSeverity, UXIssue } from "../types.js";

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };
const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: "🚨 critical",
  warning: "⚠️ warning",
  suggestion: "💡 suggestion",
};

function rel(target: string | undefined, fromDir: string | undefined): string | undefined {
  if (!target) return undefined;
  if (!fromDir) return target;
  if (!isAbsolute(target)) return target;
  return relative(fromDir, target) || target;
}

function renderIssue(issue: UXIssue): string {
  return `- **[${SEVERITY_LABEL[issue.severity]}] ${issue.category}** — _${issue.location || "unknown location"}_
  - **Issue:** ${issue.issue}
  - **Why it matters:** ${issue.why_it_matters}
  - **Fix:** ${issue.fix}`;
}

function buildCcHandoff(report: FlowReport): string {
  // A copy-paste-ready prompt block for downstream LLM coding tools (e.g.,
  // Claude Code). Combines: the team's preferences, the flow tested, the
  // findings (as both prose and JSON), and a clear instruction.
  const findings = report.analysis.issues.map((i) => ({
    severity: i.severity,
    category: i.category,
    location: i.location,
    issue: i.issue,
    why_it_matters: i.why_it_matters,
    fix: i.fix,
  }));

  const stepDsl = report.capture.spec.steps.map((s) => {
    const bits = [s.do, s.selector, s.value && `= ${s.value}`, s.label && `(${s.label})`].filter(Boolean).join(" ");
    return `  ${bits}`;
  }).join("\n");

  const lines: string[] = [];
  lines.push(`Apply the following animation/interaction fixes from a MotionLint flow review.`);
  lines.push("");
  lines.push(`**Flow tested:** \`${report.flow_name}\` against ${report.url}`);
  lines.push(`**Steps performed:**`);
  lines.push("```");
  lines.push(stepDsl);
  lines.push("```");
  lines.push("");
  if (report.preferences_md && report.preferences_md.trim()) {
    lines.push(`**Team motion preferences** (apply these as the bar — anything contradicting them should be brought into line):`);
    lines.push("");
    lines.push(report.preferences_md.trim());
    lines.push("");
  }
  lines.push(`**Findings (${findings.length})** — ranked by severity:`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(findings, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`**Instruction:** for each finding, identify the implicated CSS/JS in this codebase and apply the fix. Use the project's existing motion vocabulary (durations, easing curves) where the preferences specify them. Skip any finding that contradicts the preferences. After your edits, the same flow should rerun without those findings.`);
  return lines.join("\n");
}

export function renderFlowMarkdownReport(report: FlowReport, opts: { reportDir?: string; embedSheet?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`# MotionLint Flow Report — ${report.flow_name}`);
  lines.push("");
  lines.push(`> Animation and interaction-flow review of a recorded user journey. The vision LLM was given a contact-sheet film strip — one row per step, frames within a row taken ~88ms apart so even short (150-200ms) animations are caught. Static design issues are NOT covered here; for those, run \`motionlint review\`.`);
  lines.push("");
  lines.push(`- **URL:** ${report.url}`);
  lines.push(`- **Generated:** ${report.generated_at}`);
  lines.push(`- **Provider:** ${report.provider} (${report.model})`);
  lines.push(`- **Score:** ${report.analysis.overall_score}/10`);

  const sheetRel = rel(report.contact_sheet_path, opts.reportDir);
  const videoRel = rel(report.video_path, opts.reportDir);
  const prefsRel = rel(report.preferences_path, opts.reportDir);
  if (sheetRel) lines.push(`- **Contact sheet:** \`${sheetRel}\``);
  if (videoRel) lines.push(`- **Recorded video:** \`${videoRel}\``);
  if (prefsRel) lines.push(`- **Team preferences:** \`${prefsRel}\``);
  lines.push("");

  // Embed preferences verbatim near the top so anyone reading (human or LLM)
  // sees the bar before the findings.
  if (report.preferences_md && report.preferences_md.trim()) {
    lines.push(`## Team preferences`);
    lines.push("");
    lines.push(`> The findings below are graded against these preferences. They were applied to the system prompt and are repeated here for traceability.`);
    lines.push("");
    lines.push(report.preferences_md.trim());
    lines.push("");
  }

  if (opts.embedSheet && sheetRel) {
    lines.push(`![flow contact sheet](${sheetRel})`);
    lines.push("");
  }

  if (report.analysis.summary) {
    lines.push(`> ${report.analysis.summary.replace(/\n+/g, " ")}`);
    lines.push("");
  }

  // Step-by-step trace.
  lines.push(`## Steps executed`);
  lines.push("");
  lines.push(`| # | action | duration | status | frames |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const r of report.capture.step_results) {
    const action = `${r.step.do}${r.step.selector ? ` \`${r.step.selector}\`` : ""}${r.step.value ? ` = ${r.step.value}` : ""}`;
    const status = r.success ? "✅" : `❌ ${r.error ?? "failed"}`;
    const dur = `${r.t_end_ms - r.t_start_ms}ms`;
    lines.push(`| ${r.step_index + 1} | ${action} | ${dur} | ${status} | ${r.frame_indices.length} |`);
  }
  lines.push("");

  // Issues, sorted by severity.
  if (report.analysis.issues.length > 0) {
    const sorted = [...report.analysis.issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    lines.push(`## Findings (${report.analysis.issues.length})`);
    lines.push("");
    for (const issue of sorted) {
      lines.push(renderIssue(issue));
      lines.push("");
    }
  } else {
    lines.push(`## Findings`);
    lines.push("");
    lines.push(`_No animation issues identified._`);
    lines.push("");
  }

  if (report.latency?.length) {
    lines.push("", "## Input feedback latency", "");
    lines.push("| Step | Action | Feedback | Verdict |", "| --- | --- | --- | --- |");
    for (const m of report.latency) {
      const feedback = m.feedback_ms === null
        ? `no visual feedback within ${m.burst_window_ms}ms`
        : `${m.feedback_ms}ms`;
      lines.push(`| ${m.step_label} | ${m.action} | ${feedback} | ${m.verdict} |`);
    }
    const bad = report.latency.filter((m) => m.verdict !== "instant");
    for (const m of bad) {
      lines.push("", m.verdict === "none"
        ? `- ⚠ **${m.step_label}**: the UI never visibly acknowledged the ${m.action} — add immediate feedback (pressed state, spinner, skeleton) within 100ms.`
        : `- ⚠ **${m.step_label}**: first feedback at ${m.feedback_ms}ms — aim for <100ms perceived-instant acknowledgment.`);
    }
  }

  if (report.analysis.strengths.length > 0) {
    lines.push(`## Strengths`);
    lines.push("");
    for (const s of report.analysis.strengths) lines.push(`- ${s}`);
    lines.push("");
  }

  // Final block: a self-contained prompt the user can paste into Claude Code.
  lines.push(`## Prompt for Claude Code`);
  lines.push("");
  lines.push(`> Copy everything below into a CC session. It includes the flow, preferences, and findings as a single self-contained handoff — no other context needed.`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(buildCcHandoff(report));
  lines.push("");

  lines.push(`---`);
  lines.push(`Generated by [MotionLint](https://github.com/bobaba99/motionlint) — flow review.`);
  return lines.join("\n");
}
