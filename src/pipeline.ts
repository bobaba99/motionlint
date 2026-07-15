import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureScreenshot } from "./capture/screenshot.js";
import { captureStateGrid, GRID_STATES } from "./capture/states.js";
import { buildPrompt } from "./analysis/prompt.js";
import { resolveElementRefs } from "./analysis/annotate.js";
import { loadAddendaForPrompt } from "./eval/evolve.js";
import { resolveProvider } from "./providers/resolver.js";
import { sharedRateLimiter, withRateLimit } from "./resources/limiter.js";
import { addUsage, budgetExhausted, emptyRunUsage } from "./resources/usage.js";
import { aggregate } from "./report/aggregate.js";
import { loadBaseline } from "./memory/baseline.js";
import { applyMemory, type MemoryFilterResult } from "./memory/filter.js";
import { MemoryLockTimeoutError, withMemoryLock } from "./memory/lock.js";
import { emptyStore, loadMemory, recordFindings, saveMemory, type MemoryStore } from "./memory/store.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { renderJsonReport } from "./report/json.js";
import { renderSarifReport } from "./report/sarif.js";
import { renderReviewHtmlReport } from "./report/html.js";
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
  /** Token budget override for this run; falls back to config.resources.maxTokensPerRun. */
  maxTokens?: number | null;
  /** Also capture an interaction-state grid (hover/focus/active per element) and review it. */
  stateGrid?: boolean;
  /** Compare against this baseline URL: each viewport analyzes a CURRENT|BASELINE strip instead of a plain capture. */
  againstUrl?: string | null;
  /** Also capture each viewport under dark (and optionally forced-colors) and review the strip. */
  schemes?: boolean;
  /** Include a forced-colors: active panel in the scheme strip. */
  forcedColors?: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: "provider_resolved"; provider: VisionProvider }
  | { type: "capture_start"; viewport: Viewport }
  | { type: "capture_done"; capture: CaptureResult }
  | { type: "analyze_start"; viewport: Viewport }
  | { type: "analyze_done"; viewport: Viewport; entry: AnalysisEntry }
  | { type: "memory_warning"; message: string }
  | { type: "budget_exhausted"; viewport: Viewport; totalTokens: number; limit: number }
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
      withDom: true,
    });
    onProgress?.({ type: "capture_done", capture });
    captures.push(capture);
  }

  // Interaction-state grid: one extra pseudo-viewport imaging each interactive
  // element across default/hover/focus/active. Best-effort — a page with no
  // usable elements simply contributes nothing.
  let gridElements: string[] | null = null;
  if (opts.stateGrid) {
    const gridViewport = viewports[viewports.length - 1];
    try {
      const grid = await captureStateGrid({
        url,
        viewport: gridViewport,
        waitFor: config.waitFor,
        waitTimeout: config.waitTimeout,
        auth: config.auth,
      });
      if (grid) {
        gridElements = grid.elements;
        const capture: CaptureResult = {
          url,
          viewport: { name: "interaction-states", width: grid.width, height: grid.height },
          screenshot: grid.buffer,
          fullPage: false,
          timestamp: new Date().toISOString(),
        };
        onProgress?.({ type: "capture_done", capture });
        captures.push(capture);
      }
    } catch {
      /* grid capture is an enhancement, never a run failure */
    }
  }

  // Before/after comparison: swap each per-viewport capture for a labeled
  // CURRENT|BASELINE strip. Same analyze-call count as a plain review; DOM
  // refs are dropped because composite coordinates don't map to the page.
  const comparing = Boolean(opts.againstUrl);
  if (opts.againstUrl) {
    const { composeLabeledStrip } = await import("./capture/pair.js");
    for (let i = 0; i < captures.length; i++) {
      const current = captures[i];
      if (current.viewport.name === "interaction-states") continue;
      const baseline = await captureScreenshot({
        url: opts.againstUrl,
        viewport: current.viewport,
        fullPage: opts.fullPage ?? true,
        waitFor: config.waitFor,
        waitTimeout: config.waitTimeout,
        auth: config.auth,
        interactions: opts.interactions,
      });
      const strip = await composeLabeledStrip([
        { label: "current", png: current.screenshot },
        { label: "baseline", png: baseline.screenshot },
      ]);
      let screenshotPath = current.screenshotPath;
      if (screenshotPath) {
        const stripPath = screenshotPath.replace(/\.png$/, "") + "-vs-baseline.png";
        try {
          await writeFile(stripPath, strip);
          screenshotPath = stripPath;
        } catch (err) {
          // The strip write is a report-linking convenience, not the analysis
          // itself (the in-memory buffer is what gets analyzed either way).
          // Drop the link rather than fail the run or point at the stale
          // pre-transform image.
          onProgress?.({ type: "memory_warning", message: `comparison strip write failed: ${(err as Error).message}` });
          screenshotPath = undefined;
        }
      }
      captures[i] = {
        ...current,
        screenshot: strip,
        screenshotPath,
        fullPage: false,
        dom: undefined,
        viewport: { ...current.viewport, name: `${current.viewport.name}-vs-baseline` },
      };
    }
  }

  // Color-scheme sweep: one extra pseudo-viewport per real viewport showing
  // light | dark (| forced-colors) renderings side by side.
  const schemeNames: Set<string> = new Set();
  if (opts.schemes) {
    const { composeLabeledStrip } = await import("./capture/pair.js");
    const baseCaptures = captures.filter((c) => c.viewport.name !== "interaction-states" && !c.viewport.name.endsWith("-vs-baseline"));
    for (const light of baseCaptures) {
      try {
        const dark = await captureScreenshot({
          url,
          viewport: light.viewport,
          fullPage: opts.fullPage ?? true,
          waitFor: config.waitFor,
          waitTimeout: config.waitTimeout,
          auth: config.auth,
          interactions: opts.interactions,
          colorScheme: "dark",
        });
        const panels = [
          { label: "light", png: light.screenshot },
          { label: "dark", png: dark.screenshot },
        ];
        if (opts.forcedColors) {
          const forced = await captureScreenshot({
            url,
            viewport: light.viewport,
            fullPage: opts.fullPage ?? true,
            waitFor: config.waitFor,
            waitTimeout: config.waitTimeout,
            auth: config.auth,
            interactions: opts.interactions,
            forcedColors: true,
          });
          panels.push({ label: "forced colors", png: forced.screenshot });
        }
        const strip = await composeLabeledStrip(panels);
        const name = `${light.viewport.name}-schemes`;
        schemeNames.add(name);
        const capture: CaptureResult = {
          url,
          viewport: { name, width: light.viewport.width, height: light.viewport.height },
          screenshot: strip,
          fullPage: false,
          timestamp: new Date().toISOString(),
        };
        onProgress?.({ type: "capture_done", capture });
        captures.push(capture);
      } catch {
        /* scheme sweep is an enhancement, never a run failure */
      }
    }
  }

  const tokenLimit = opts.maxTokens !== undefined ? opts.maxTokens : config.resources.maxTokensPerRun;
  let usage = emptyRunUsage(typeof tokenLimit === "number" && tokenLimit > 0 ? tokenLimit : null);

  // Learned heuristics from `eval --evolve`, if the project has run it.
  const learned = config.learnedHeuristics ? await loadAddendaForPrompt(config.learnedHeuristics) : null;

  const analyses: AnalysisEntry[] = [];
  for (const capture of captures) {
    // Cost ceiling: once the running total crosses the budget, stop paying for
    // further viewports — the report carries what was analyzed plus the skip list.
    if (budgetExhausted(usage)) {
      usage = { ...usage, skipped_viewports: [...usage.skipped_viewports, capture.viewport.name] };
      onProgress?.({ type: "budget_exhausted", viewport: capture.viewport, totalTokens: usage.total_tokens, limit: usage.limit as number });
      continue;
    }
    onProgress?.({ type: "analyze_start", viewport: capture.viewport });
    const isGrid = capture.viewport.name === "interaction-states" && gridElements !== null;
    const prompt = await buildPrompt({
      viewportName: capture.viewport.name,
      rulesPath: opts.rulesPath ?? config.rules,
      elements: capture.dom?.elements,
      learned,
      ...(isGrid ? { stateGrid: { states: GRID_STATES, elements: gridElements as string[] } } : {}),
      ...(comparing && capture.viewport.name.endsWith("-vs-baseline")
        ? { compare: { baselineUrl: opts.againstUrl as string } }
        : {}),
      ...(schemeNames.has(capture.viewport.name)
        ? { schemePair: { schemes: opts.forcedColors ? ["light", "dark", "forced-colors"] : ["light", "dark"] } }
        : {}),
    });
    const analysis = resolveElementRefs(
      await provider.analyze(capture.screenshot, prompt, capture.viewport.name),
      capture.dom,
    );
    usage = addUsage(usage, analysis.usage);
    const entry: AnalysisEntry = { capture, analysis };
    analyses.push(entry);
    onProgress?.({ type: "analyze_done", viewport: capture.viewport, entry });
  }

  let reportAnalyses = analyses;
  let memoryOmitted: { by_baseline: number; by_memory: number } | undefined;
  if (opts.memory ?? config.memory.enabled) {
    const baseline = await loadBaseline(opts.baselinePath ?? config.memory.baseline);
    const runMemory = async (): Promise<MemoryFilterResult> => {
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
      const observed = analyses.flatMap((entry) => entry.analysis.issues);
      await saveMemory(config.memory.path, recordFindings(store, url, observed, new Date().toISOString()));
      return filtered;
    };
    let filtered: MemoryFilterResult;
    try {
      // Lock spans the whole read-modify-write so concurrent reviews of one
      // project don't clobber each other's recorded sightings.
      filtered = await withMemoryLock(config.memory.path, runMemory);
    } catch (err) {
      if (!(err instanceof MemoryLockTimeoutError)) throw err;
      // Availability over strictness: a wedged lock must not fail the review.
      onProgress?.({
        type: "memory_warning",
        message: `${err.message} Proceeding without the lock; concurrently recorded sightings may be lost.`,
      });
      filtered = await runMemory();
    }
    reportAnalyses = filtered.analyses;
    memoryOmitted = { by_baseline: filtered.by_baseline, by_memory: filtered.by_memory };
  }

  const report: ReviewReport = {
    ...aggregate(url, provider.name, provider.model, reportAnalyses, {
      maxFindings: opts.maxFindings !== undefined ? opts.maxFindings : config.maxFindings,
      omitted: memoryOmitted,
      usage,
    }),
    ...(opts.againstUrl ? { against: opts.againstUrl } : {}),
  };

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
    case "html":
      rendered = renderReviewHtmlReport(report);
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
