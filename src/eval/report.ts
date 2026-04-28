import type { EvalReport, FixtureScore, LevelResult } from "./types.js";

const STATUS_ICON = (passing: boolean): string => (passing ? "✅ PASS" : "❌ FAIL");

function fixtureLine(f: FixtureScore): string {
  const recallPct = (f.recall * 100).toFixed(0);
  const tag = f.expected === 0
    ? f.control_violation
      ? "❌ control violated"
      : "✅ control clean"
    : f.detected === f.expected
      ? `✅ ${f.detected}/${f.expected}`
      : `⚠️ ${f.detected}/${f.expected}`;
  return `| \`${f.fixture}\` | ${f.viewport} | ${tag} | ${recallPct}% | ${f.surprise_critical} / ${f.surprise_warning} | ${f.ux_concept ?? "—"} |`;
}

function renderFixtureDetail(f: FixtureScore): string {
  const lines: string[] = [];
  lines.push(`#### \`${f.fixture}\` @ ${f.viewport}`);
  lines.push("");
  lines.push(`- **Seeded fault (held out from model):** ${f.label}`);
  if (f.ux_concept) lines.push(`- **UX concept under test:** ${f.ux_concept}`);
  lines.push(`- **Recall:** ${f.detected}/${f.expected} = ${(f.recall * 100).toFixed(0)}%`);
  lines.push(`- **Surprise findings:** ${f.surprise_critical} critical · ${f.surprise_warning} warning`);
  lines.push("");
  if (f.expected > 0) {
    lines.push(`**Expected → matched**`);
    for (const r of f.per_expected) {
      const got = r.matched_issue
        ? `✅ matched: \`[${r.matched_issue.severity}] ${r.matched_issue.category}\` — _${r.matched_issue.location}_ → "${r.matched_issue.issue}"`
        : `❌ MISSED`;
      lines.push(`- categories=${JSON.stringify(r.expected.categories)} severity≥${r.expected.min_severity} kw=${JSON.stringify(r.expected.any_keywords.slice(0, 3))} → ${got}`);
    }
    lines.push("");
  }
  lines.push(`**Model output (overall ${f.raw.overall_score}/10):** ${f.raw.summary}`);
  if (f.raw.issues.length > 0) {
    lines.push("");
    for (const i of f.raw.issues) {
      lines.push(`  - [${i.severity}] **${i.category}** — _${i.location}_: ${i.issue}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderLevel(level: LevelResult): string {
  const lines: string[] = [];
  lines.push(`## Level: ${level.level} — ${STATUS_ICON(level.passing)}`);
  lines.push("");
  lines.push(`> ${level.summary}`);
  lines.push("");
  lines.push(`- **Recall:** ${level.total_detected}/${level.total_expected} labeled signals = **${(level.recall * 100).toFixed(1)}%** (threshold ≥ ${(level.thresholds.min_recall * 100).toFixed(0)}%)`);
  lines.push(`- **Control violations:** ${level.control_violations} (threshold ≤ ${level.thresholds.max_control_violations})`);
  if (level.failure_reason) lines.push(`- **Failure reason:** ${level.failure_reason}`);
  lines.push("");
  lines.push(`| fixture | viewport | result | recall | surprise crit/warn | concept |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const f of level.fixtures) lines.push(fixtureLine(f));
  lines.push("");
  for (const f of level.fixtures) lines.push(renderFixtureDetail(f));
  return lines.join("\n");
}

function renderNextActions(report: EvalReport): string {
  if (report.next_actions.length === 0) return "_No outstanding actions — eval is fully passing._";
  const lines: string[] = [];
  lines.push("These are structured TODOs an LLM coding tool can act on directly. Each entry maps to a specific UX dimension and a remediation hypothesis.");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.next_actions, null, 2));
  lines.push("```");
  return lines.join("\n");
}

export function renderEvalReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# MotionLint Eval Report`);
  lines.push("");
  lines.push(`> Blind labeled-truth evaluation of a vision LLM's ability to identify UI/UX faults from screenshots alone. Labels are held out from every API call. This report is structured for downstream consumption by LLM coding tools.`);
  lines.push("");
  lines.push(`## Header`);
  lines.push("");
  lines.push(`- **Generated:** ${report.generated_at}`);
  lines.push(`- **Provider:** ${report.provider}`);
  lines.push(`- **Model:** ${report.model}`);
  lines.push(`- **Truth version:** ${report.truth_version}`);
  lines.push(`- **Highest passing level:** ${report.highest_passing_level ?? "(none)"}`);
  lines.push(`- **First failing level:** ${report.first_failing_level ?? "(none — all attempted levels passed)"}`);
  lines.push(`- **Overall:** ${STATUS_ICON(report.overall_passing)}`);
  lines.push("");

  if (report.terminology) {
    lines.push(`## Terminology used in this report`);
    lines.push("");
    for (const [k, v] of Object.entries(report.terminology)) {
      lines.push(`- **${k}** — ${v}`);
    }
    lines.push("");
  }

  lines.push(`## Result summary`);
  lines.push("");
  lines.push(`| level | result | recall | controls | reason |`);
  lines.push(`|---|---|---|---|---|`);
  for (const l of report.levels) {
    lines.push(`| ${l.level} | ${STATUS_ICON(l.passing)} | ${(l.recall * 100).toFixed(1)}% | ${l.control_violations} violations | ${l.failure_reason ?? "—"} |`);
  }
  lines.push("");

  lines.push(`## Next actions for the coding agent`);
  lines.push("");
  lines.push(renderNextActions(report));
  lines.push("");

  for (const l of report.levels) lines.push(renderLevel(l));

  lines.push(`---`);
  lines.push(`Generated by [MotionLint](https://github.com/bobaba99/motionlint) — eval harness ${report.truth_version}.`);
  return lines.join("\n");
}
