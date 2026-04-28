import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { extname, join, resolve as resolvePath } from "node:path";
import { runFlow } from "./runner.js";
import { renderFlowMarkdownReport } from "./report.js";
import { softKeywordMatch } from "../eval/synonyms.js";
import type { FlowSpec, FlowStep, FlowReport } from "./types.js";
import type { UXIssue } from "../types.js";

interface PatternDef {
  id: string;
  concept: string;
  good_fixture: string;
  bad_fixture: string;
  expected_fault_keywords: string[];
  steps: FlowStep[];
}

interface StressDef {
  description?: string;
  patterns: PatternDef[];
}

export interface StressResult {
  pattern_id: string;
  concept: string;
  variant: "good" | "bad";
  fixture: string;
  /** True if the LLM's findings included a relevant animation issue. */
  detected_fault: boolean;
  /** True if at least one finding mentioned the seeded keyword. */
  keyword_match: boolean;
  /** Total findings the LLM raised. */
  issue_count: number;
  critical_count: number;
  /** Score the LLM gave the fixture. */
  overall_score: number;
  /** Path to the saved per-fixture flow report. */
  report_path: string;
  /** Truncated summary for the table. */
  summary: string;
  /** The single best matching issue, if any. */
  matched_issue?: UXIssue;
}

export interface StressReport {
  generated_at: string;
  provider: string;
  model: string;
  results: StressResult[];
  /** Recall on broken variants (TPR). */
  broken_recall: number;
  /** Mistaken-flag rate on good variants — counts critical-severity findings as false positives. */
  good_false_positive_rate: number;
  /** Average score gap (good − bad) — positive means LLM rates clean implementations higher. */
  avg_score_gap: number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

async function startStaticServer(rootDir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const root = resolvePath(rootDir);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname.replace(/^\/anim\//, "/");
      const filePath = resolvePath(join(root, pathname));
      if (!filePath.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }
      const st = await stat(filePath).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
      const data = await readFile(filePath);
      res.writeHead(200, {
        "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch (err) {
      res.writeHead(500); res.end((err as Error).message);
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

function detectFault(issues: UXIssue[], keywords: string[]): { detected: boolean; matched?: UXIssue } {
  for (const i of issues) {
    const haystack = `${i.issue} ${i.location} ${i.fix} ${i.why_it_matters} ${i.category}`;
    if (softKeywordMatch(haystack, keywords)) return { detected: true, matched: i };
  }
  return { detected: false };
}

export interface RunStressOptions {
  stressPath: string;
  fixturesDir: string;
  artifactDir: string;
  provider?: string;
  model?: string | null;
  consistency?: number;
  /** Restrict to specific pattern ids. */
  only?: string[];
  onProgress?: (event: { type: "pattern"; pattern: string; variant: "good" | "bad"; index: number; total: number }) => void;
}

export async function runStress(opts: RunStressOptions): Promise<StressReport> {
  const def = JSON.parse(await readFile(opts.stressPath, "utf8")) as StressDef;
  const patterns = opts.only?.length ? def.patterns.filter((p) => opts.only!.includes(p.id)) : def.patterns;
  const total = patterns.length * 2;

  const server = await startStaticServer(opts.fixturesDir);
  await mkdir(opts.artifactDir, { recursive: true });

  const results: StressResult[] = [];
  let providerName = "";
  let modelName = "";
  let idx = 0;

  try {
    for (const pat of patterns) {
      for (const variant of ["good", "bad"] as const) {
        idx++;
        opts.onProgress?.({ type: "pattern", pattern: pat.id, variant, index: idx, total });
        const fixture = variant === "good" ? pat.good_fixture : pat.bad_fixture;
        const url = `${server.url}/anim/${fixture}`;
        const spec: FlowSpec = {
          name: `${pat.id}-${variant}`,
          url,
          steps: pat.steps,
          expected_animations: variant === "good" ? [pat.concept] : undefined,
        };

        let report: FlowReport;
        try {
          report = await runFlow({
            spec,
            provider: opts.provider,
            model: opts.model ?? null,
            consistency: Math.max(1, opts.consistency ?? 1),
            artifactDir: opts.artifactDir,
            videoDir: undefined,
            burstStrategy: "screencast",
            burstFullPage: false,
          });
        } catch (err) {
          // Failure (network, provider, etc.) — record it but don't crash the run.
          results.push({
            pattern_id: pat.id,
            concept: pat.concept,
            variant,
            fixture,
            detected_fault: false,
            keyword_match: false,
            issue_count: 0,
            critical_count: 0,
            overall_score: 0,
            report_path: "",
            summary: `ERROR: ${(err as Error).message}`,
          });
          continue;
        }

        providerName = report.provider;
        modelName = report.model;

        const reportPath = join(opts.artifactDir, `${pat.id}-${variant}.md`);
        await writeFile(reportPath, renderFlowMarkdownReport(report, { reportDir: dirname(reportPath) }), "utf8");

        // For broken variants: a "detected fault" requires keyword match against expected_fault_keywords.
        // For good variants: any critical-severity finding is a false positive.
        const fault = variant === "bad" ? detectFault(report.analysis.issues, pat.expected_fault_keywords) : { detected: false };
        const critical_count = report.analysis.issues.filter((i) => i.severity === "critical").length;

        results.push({
          pattern_id: pat.id,
          concept: pat.concept,
          variant,
          fixture,
          detected_fault: variant === "bad" ? fault.detected : critical_count === 0,
          keyword_match: variant === "bad" ? fault.detected : false,
          issue_count: report.analysis.issues.length,
          critical_count,
          overall_score: report.analysis.overall_score,
          report_path: reportPath,
          summary: report.analysis.summary.slice(0, 180),
          matched_issue: variant === "bad" ? fault.matched : undefined,
        });
      }
    }
  } finally {
    await server.close();
  }

  // Aggregate metrics.
  const broken = results.filter((r) => r.variant === "bad");
  const good = results.filter((r) => r.variant === "good");
  const broken_recall = broken.length === 0 ? 0 : broken.filter((r) => r.detected_fault).length / broken.length;
  const good_false_positive_rate = good.length === 0 ? 0 : good.filter((r) => r.critical_count > 0).length / good.length;

  // Score gap pairs by pattern_id.
  let totalGap = 0;
  let pairs = 0;
  for (const pat of patterns) {
    const g = results.find((r) => r.pattern_id === pat.id && r.variant === "good");
    const b = results.find((r) => r.pattern_id === pat.id && r.variant === "bad");
    if (g && b && g.overall_score > 0 && b.overall_score > 0) {
      totalGap += g.overall_score - b.overall_score;
      pairs++;
    }
  }
  const avg_score_gap = pairs === 0 ? 0 : totalGap / pairs;

  return {
    generated_at: new Date().toISOString(),
    provider: providerName,
    model: modelName,
    results,
    broken_recall,
    good_false_positive_rate,
    avg_score_gap: Math.round(avg_score_gap * 10) / 10,
  };
}

export function renderStressMarkdown(report: StressReport): string {
  const lines: string[] = [];
  lines.push(`# MotionLint Animation Stress Test`);
  lines.push("");
  lines.push(`> Comprehensive evaluation of \`motionlint flow\` across 8 popular web-app animation patterns × 2 variants (well-implemented vs deliberately broken). For broken variants we measure **recall** — did the LLM correctly identify the seeded animation fault? For good variants we measure **false positive rate** — did the LLM hallucinate critical issues on a clean implementation?`);
  lines.push("");
  lines.push(`- **Generated:** ${report.generated_at}`);
  lines.push(`- **Provider:** ${report.provider} (${report.model})`);
  lines.push(`- **Broken recall:** ${(report.broken_recall * 100).toFixed(0)}% (correctly flagged seeded faults)`);
  lines.push(`- **Good false-positive rate:** ${(report.good_false_positive_rate * 100).toFixed(0)}% (clean fixtures incorrectly given critical findings)`);
  lines.push(`- **Avg score gap (good − bad):** ${report.avg_score_gap > 0 ? "+" : ""}${report.avg_score_gap.toFixed(1)} (positive = LLM scores good higher than bad)`);
  lines.push("");

  lines.push(`## Per-pattern results`);
  lines.push("");
  lines.push(`| pattern | variant | result | issues | crit | score | summary |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of report.results) {
    const tag = r.variant === "bad"
      ? (r.detected_fault ? "✅ caught" : "❌ MISSED")
      : (r.critical_count === 0 ? "✅ clean" : "❌ FALSE POSITIVE");
    const summary = r.summary.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 100);
    lines.push(`| \`${r.pattern_id}\` | ${r.variant} | ${tag} | ${r.issue_count} | ${r.critical_count} | ${r.overall_score}/10 | ${summary} |`);
  }
  lines.push("");

  // Per-pattern detail.
  for (const r of report.results) {
    if (r.variant !== "bad") continue;
    lines.push(`### ${r.pattern_id} (${r.concept})`);
    lines.push("");
    lines.push(`**Variant:** broken — ${r.detected_fault ? "✅ caught" : "❌ MISSED"}`);
    if (r.matched_issue) {
      lines.push(`**Matched finding:** \`[${r.matched_issue.severity}] ${r.matched_issue.category}\` — ${r.matched_issue.issue}`);
      lines.push(`**Suggested fix from LLM:** ${r.matched_issue.fix}`);
    } else {
      lines.push(`**No matching finding.** The LLM raised ${r.issue_count} other findings but none matched the expected fault keywords for this pattern.`);
    }
    lines.push(`**Per-fixture report:** [\`${r.report_path}\`](${r.report_path})`);
    lines.push("");
  }

  lines.push("---");
  lines.push("Generated by MotionLint animation stress-test harness.");
  return lines.join("\n");
}
