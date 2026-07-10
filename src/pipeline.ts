import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureScreenshot } from "./capture/screenshot.js";
import { buildPrompt } from "./analysis/prompt.js";
import { resolveProvider } from "./providers/resolver.js";
import { sharedRateLimiter, withRateLimit } from "./resources/limiter.js";
import { aggregate } from "./report/aggregate.js";
import { loadBaseline } from "./memory/baseline.js";
import { applyMemory } from "./memory/filter.js";
import { emptyStore, loadMemory, recordFindings, saveMemory, type MemoryStore } from "./memory/store.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { renderJsonReport } from "./report/json.js";
import { renderSarifReport } from "./report/sarif.js";
import type {
  AnalysisEntry,
  CaptureResult,
  InteractionStep,
  IssueSeverity,
  OutputFormat,
  ReviewReport,
  MotionLintConfig,
  Viewport,
  VisionProvider,
} from "./types.js";

export interface RunReviewOptions {
  url: string;
  config: MotionLintConfig;
  provider?: string;
  model?: string | null;
  viewports?: string[];
  rulesPath?: string | null;
  record?: boolean;
  fullPage?: boolean;
  interactions?: InteractionStep[];
  format?: OutputFormat;
  outputPath?: string | null;
  embedScreenshots?: boolean;
  /** Per-run output cap override; falls back to config.maxFindings. */
  maxFindings?: number | null;
  /** PR-surface cap override (SARIF only); falls back to config.maxPrAnnotations. */
  maxPrAnnotations?: number | null;
  /** Cross-run memory override; falls back to config.memory.enabled. */
  memory?: boolean;
  /** Baseline file override; falls back to config.memory.baseline. */
  baselinePath?: string | null;
  /** Report only findings not seen in prior runs; falls back to config.memory.newOnly. */
  newOnly?: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: "provider_resolved"; provider: VisionProvider }
  | { type: "capture_start"; viewport: Viewport }
  | { type: "capture_done"; capture: CaptureResult }
  | { type: "analyze_start"; viewport: Viewport }
  | { type: "analyze_done"; viewport: Viewport; entry: AnalysisEntry }
  | { type: "memory_warning"; message: string }
  | { type: "report_written"; path: string; format: OutputFormat };

export interface RunReviewResult {
  report: ReviewReport;
  rendered: string;
  format: OutputFormat;
  reportPath: string | null;
  exitCode: number;
}

function pickViewports(cfg: MotionLintConfig, requested?: string[]): Viewport[] {
  const wanted = requested?.length ? requested : cfg.defaultViewports;
  const out: Viewport[] = [];
  for (const name of wanted) {
    const v = cfg.viewports[name];
    if (!v) throw new Error(`Unknown viewport "${name}". Available: ${Object.keys(cfg.viewports).join(", ")}`);
    out.push({ name, width: v.width, height: v.height });
  }
  return out;
}

function shouldFail(report: ReviewReport, cfg: MotionLintConfig): boolean {
  if (cfg.ci.failOnCritical && report.critical_count > 0) return true;
  const threshold: IssueSeverity = cfg.ci.threshold;
  if (threshold === "critical") return report.critical_count > 0;
  if (threshold === "warning") return report.critical_count + report.warning_count > 0;
  if (threshold === "suggestion") {
    return report.critical_count + report.warning_count + report.suggestion_count > 0;
  }
  return false;
}

function reportFilename(url: string, format: OutputFormat): string {
  const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `motionlint-${slug || "report"}-${stamp}.${format}`;
}

export async function runReview(opts: RunReviewOptions): Promise<RunReviewResult> {
  const { config, url, onProgress } = opts;
  const viewports = pickViewports(config, opts.viewports);

  const provider = withRateLimit(
    await resolveProvider({
      provider: opts.provider ?? config.provider,
      model: opts.model ?? config.model,
      fallbackProvider: config.fallbackProvider,
      fallbackModel: config.fallbackModel,
    }),
    sharedRateLimiter(config.resources.providerCallsPerMinute),
  );
  onProgress?.({ type: "provider_resolved", provider });

  const captures: CaptureResult[] = [];
  for (const viewport of viewports) {
    onProgress?.({ type: "capture_start", viewport });
    const capture = await captureScreenshot({
      url,
      viewport,
      fullPage: opts.fullPage ?? true,
      waitFor: config.waitFor,
      waitTimeout: config.waitTimeout,
      record: opts.record ?? config.record,
      videoDir: config.videoDir,
      screenshotDir: config.screenshotDir,
      auth: config.auth,
      interactions: opts.interactions,
    });
    onProgress?.({ type: "capture_done", capture });
    captures.push(capture);
  }

  const analyses: AnalysisEntry[] = [];
  for (const capture of captures) {
    onProgress?.({ type: "analyze_start", viewport: capture.viewport });
    const prompt = await buildPrompt({
      viewportName: capture.viewport.name,
      rulesPath: opts.rulesPath ?? config.rules,
    });
    const analysis = await provider.analyze(capture.screenshot, prompt, capture.viewport.name);
    const entry: AnalysisEntry = { capture, analysis };
    analyses.push(entry);
    onProgress?.({ type: "analyze_done", viewport: capture.viewport, entry });
  }

  let reportAnalyses = analyses;
  let memoryOmitted: { by_baseline: number; by_memory: number } | undefined;
  if (opts.memory ?? config.memory.enabled) {
    const baseline = await loadBaseline(opts.baselinePath ?? config.memory.baseline);
    let store: MemoryStore;
    try {
      store = await loadMemory(config.memory.path);
    } catch (err) {
      // A corrupt store must not fail the review — warn and rebuild from this run.
      onProgress?.({ type: "memory_warning", message: (err as Error).message });
      store = emptyStore();
    }
    const filtered = applyMemory({
      analyses,
      url,
      baseline,
      store,
      newOnly: opts.newOnly ?? config.memory.newOnly,
    });
    reportAnalyses = filtered.analyses;
    memoryOmitted = { by_baseline: filtered.by_baseline, by_memory: filtered.by_memory };
    const observed = analyses.flatMap((entry) => entry.analysis.issues);
    await saveMemory(config.memory.path, recordFindings(store, url, observed, new Date().toISOString()));
  }

  const report = aggregate(url, provider.name, provider.model, reportAnalyses, {
    maxFindings: opts.maxFindings !== undefined ? opts.maxFindings : config.maxFindings,
    omitted: memoryOmitted,
  });

  const format: OutputFormat = opts.format ?? "md";
  let rendered: string;
  switch (format) {
    case "json":
      rendered = renderJsonReport(report);
      break;
    case "sarif":
      rendered = renderSarifReport(report, {
        maxAnnotations: opts.maxPrAnnotations !== undefined ? opts.maxPrAnnotations : config.maxPrAnnotations,
      });
      break;
    default:
      rendered = renderMarkdownReport(report, {
        embedScreenshots: opts.embedScreenshots ?? false,
        reportDir: config.reportDir,
      });
  }

  let reportPath: string | null = null;
  if (opts.outputPath !== null) {
    const dir = config.reportDir;
    await mkdir(dir, { recursive: true });
    reportPath = opts.outputPath ?? join(dir, reportFilename(url, format));
    await writeFile(reportPath, rendered, "utf8");
    onProgress?.({ type: "report_written", path: reportPath, format });
  }

  return {
    report,
    rendered,
    format,
    reportPath,
    exitCode: shouldFail(report, config) ? 1 : 0,
  };
}
