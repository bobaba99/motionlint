import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { captureScreenshot } from "../capture/screenshot.js";
import { captureMosaic } from "../capture/mosaic.js";
import { captureDomSnapshot, type DomSnapshot } from "../capture/dom.js";
import { launchBrowserSession } from "../capture/browser.js";
import { buildPrompt } from "../analysis/prompt.js";
import { resolveProvider } from "../providers/resolver.js";
import { SelfConsistencyProvider } from "../providers/consistency.js";
import type { Viewport, VisionProvider, AnalysisResult } from "../types.js";
import { scoreFixture } from "./scorer.js";
import { startEvalServer } from "./server.js";
import type {
  EvalReport,
  FixtureLabel,
  FixtureScore,
  LevelDefinition,
  LevelResult,
  NextAction,
  TruthFile,
} from "./types.js";

export interface RunEvalOptions {
  truthPath: string;
  fixturesDir: string;
  provider?: string;
  model?: string | null;
  viewports?: { mobile: Viewport; tablet: Viewport; desktop: Viewport };
  only?: string[];
  onlyLevels?: string[];
  stopOnFail?: boolean;
  screenshotDir?: string;
  /** Bundle all viewports of a fixture into one mosaic image per call (C1). */
  mosaic?: boolean;
  /** Pass DOM measurements alongside the screenshot (D1+D2). */
  withDom?: boolean;
  /** Number of self-consistency samples per fixture (B2). 1 = off. */
  consistency?: number;
  onProgress?: (event: EvalProgress) => void;
}

export type EvalProgress =
  | { type: "server_started"; url: string }
  | { type: "level_start"; level: string; fixtures: number }
  | { type: "fixture_start"; level: string; fixture: string; viewport: string }
  | { type: "fixture_scored"; score: FixtureScore }
  | { type: "level_done"; result: LevelResult }
  | { type: "server_stopped" };

const DEFAULT_VIEWPORTS = {
  mobile: { name: "mobile", width: 375, height: 812 },
  tablet: { name: "tablet", width: 768, height: 1024 },
  desktop: { name: "desktop", width: 1440, height: 900 },
} as const;

function failureReason(
  recall: number,
  control_violations: number,
  thresholds: { min_recall: number; max_control_violations: number },
  total_detected: number,
  total_expected: number,
): string | undefined {
  const reasons: string[] = [];
  if (recall < thresholds.min_recall) {
    reasons.push(`recall ${(recall * 100).toFixed(1)}% < required ${(thresholds.min_recall * 100).toFixed(0)}% (${total_detected}/${total_expected} labeled signals detected)`);
  }
  if (control_violations > thresholds.max_control_violations) {
    reasons.push(`control violations ${control_violations} > allowed ${thresholds.max_control_violations}`);
  }
  return reasons.length ? reasons.join("; ") : undefined;
}

function buildNextActions(level: LevelResult): NextAction[] {
  const actions: NextAction[] = [];
  for (const f of level.fixtures) {
    for (const r of f.per_expected) {
      if (r.matched_issue) continue;
      const ex = r.expected;
      actions.push({
        level: level.level,
        fixture: f.fixture,
        ux_concept: f.ux_concept,
        category: ex.categories[0],
        severity: ex.min_severity,
        description: `Model failed to surface a ${ex.min_severity}-severity ${ex.categories.join("/")} finding on fixture "${f.fixture}". Seeded fault: ${f.label}`,
        expected_signal: `An issue with category ∈ {${ex.categories.join(", ")}}, severity ≥ ${ex.min_severity}, mentioning any of: ${ex.any_keywords.slice(0, 6).join(", ")}.`,
        suggested_fix:
          "Tighten the system prompt for this UX dimension. Add an explicit checkpoint and one positive/negative example. " +
          "If the dimension already has a checkpoint, raise its priority and require the model to evaluate it before producing the summary.",
      });
    }
    if (f.control_violation) {
      actions.push({
        level: level.level,
        fixture: f.fixture,
        ux_concept: f.ux_concept,
        category: "consistency",
        severity: "warning",
        description: `Control fixture "${f.fixture}" was flagged with ${f.surprise_critical} critical and ${f.surprise_warning} warning issues — these are false positives on a deliberately clean page.`,
        expected_signal: "Zero critical issues; surprise warnings within the configured budget.",
        suggested_fix:
          "Add a 'do-not-over-flag' instruction to the system prompt: when a page is well-designed, return an empty issues array and emphasize strengths.",
      });
    }
  }
  return actions;
}

async function captureWithDom(
  url: string,
  viewport: Viewport,
  screenshotDir?: string,
): Promise<{ screenshot: Buffer; dom: DomSnapshot; screenshotPath?: string }> {
  // Reuse a single browser session so the screenshot and DOM snapshot are taken from the same render.
  const session = await launchBrowserSession({ viewport });
  try {
    const page = await session.context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 10_000 });
    const dom = await captureDomSnapshot(page);
    const screenshot = await page.screenshot({ type: "png", fullPage: true });
    let screenshotPath: string | undefined;
    if (screenshotDir) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      await mkdir(screenshotDir, { recursive: true });
      const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      screenshotPath = join(screenshotDir, `${slug}-${viewport.name}-${Date.now()}.png`);
      await writeFile(screenshotPath, screenshot);
    }
    await page.close();
    return { screenshot, dom, screenshotPath };
  } finally {
    await session.close();
  }
}

async function analyzeFixture(
  fixture: FixtureLabel,
  serverUrl: string,
  viewports: Record<string, Viewport>,
  provider: VisionProvider,
  rulesPath: string | null,
  withDom: boolean,
  mosaic: boolean,
  screenshotDir: string | undefined,
  onProgress: ((event: EvalProgress) => void) | undefined,
  level: string,
): Promise<FixtureScore[]> {
  const url = `${serverUrl}${fixture.url}`;
  const scores: FixtureScore[] = [];

  if (mosaic && fixture.viewports.length > 1) {
    onProgress?.({ type: "fixture_start", level, fixture: fixture.name, viewport: "mosaic" });
    const vps = fixture.viewports.map((v) => viewports[v]!);
    const mos = await captureMosaic({
      url,
      viewports: vps,
      waitFor: "networkidle",
      waitTimeout: 10_000,
      screenshotDir,
    });
    let dom: DomSnapshot | null = null;
    if (withDom) {
      // DOM snapshot at the smallest viewport (mobile) where most L3 conditional faults manifest.
      const tightest = vps.reduce((a, b) => (a.width < b.width ? a : b));
      const captured = await captureWithDom(url, tightest);
      dom = captured.dom;
    }
    const prompt = await buildPrompt({
      viewportName: fixture.viewports.join("+"),
      rulesPath,
      mosaic: { viewports: vps },
      domSnapshot: dom,
    });
    const analysis = await provider.analyze(mos.buffer, prompt, fixture.viewports.join("+"));
    const score = scoreFixture(fixture, fixture.viewports.join("+"), analysis, level);
    scores.push(score);
    onProgress?.({ type: "fixture_scored", score });
    return scores;
  }

  for (const vname of fixture.viewports) {
    const vp = viewports[vname];
    if (!vp) throw new Error(`Unknown viewport "${vname}" referenced by fixture "${fixture.name}".`);
    onProgress?.({ type: "fixture_start", level, fixture: fixture.name, viewport: vname });

    let screenshot: Buffer;
    let dom: DomSnapshot | null = null;
    if (withDom) {
      const captured = await captureWithDom(url, vp, screenshotDir);
      screenshot = captured.screenshot;
      dom = captured.dom;
    } else {
      const cap = await captureScreenshot({
        url,
        viewport: vp,
        fullPage: true,
        waitFor: "networkidle",
        waitTimeout: 10_000,
        screenshotDir,
      });
      screenshot = cap.screenshot;
    }

    const prompt = await buildPrompt({ viewportName: vname, rulesPath, domSnapshot: dom });
    const analysis: AnalysisResult = await provider.analyze(screenshot, prompt, vname);
    const score = scoreFixture(fixture, vname, analysis, level);
    scores.push(score);
    onProgress?.({ type: "fixture_scored", score });
  }
  return scores;
}

export async function runEval(opts: RunEvalOptions): Promise<EvalReport> {
  const truthRaw = await readFile(opts.truthPath, "utf8");
  const truth = JSON.parse(truthRaw) as TruthFile;
  const fixturesDir = resolve(opts.fixturesDir);
  const viewports = opts.viewports ?? DEFAULT_VIEWPORTS;
  const stopOnFail = opts.stopOnFail !== false;

  let provider = await resolveProvider({
    provider: opts.provider,
    model: opts.model ?? null,
  });
  if (opts.consistency && opts.consistency > 1) {
    provider = new SelfConsistencyProvider(provider, { samples: opts.consistency });
  }

  const server = await startEvalServer(fixturesDir, 0);
  opts.onProgress?.({ type: "server_started", url: server.url });

  const filterFixtures = (fixtures: FixtureLabel[]): FixtureLabel[] =>
    opts.only?.length ? fixtures.filter((f) => opts.only!.includes(f.name)) : fixtures;
  const filterLevels = (levels: LevelDefinition[]): LevelDefinition[] =>
    opts.onlyLevels?.length ? levels.filter((l) => opts.onlyLevels!.includes(l.name)) : levels;

  const levelResults: LevelResult[] = [];
  let highest_passing_level: string | null = null;
  let first_failing_level: string | null = null;

  try {
    for (const level of filterLevels(truth.levels)) {
      const fixturesInLevel = filterFixtures(level.fixtures);
      if (fixturesInLevel.length === 0) continue;
      opts.onProgress?.({ type: "level_start", level: level.name, fixtures: fixturesInLevel.length });

      const fixtureScores: FixtureScore[] = [];
      for (const fixture of fixturesInLevel) {
        const scores = await analyzeFixture(
          fixture,
          server.url,
          viewports as Record<string, Viewport>,
          provider,
          null,
          opts.withDom ?? false,
          opts.mosaic ?? false,
          opts.screenshotDir,
          opts.onProgress,
          level.name,
        );
        fixtureScores.push(...scores);
      }

      const total_expected = fixtureScores.reduce((acc, s) => acc + s.expected, 0);
      const total_detected = fixtureScores.reduce((acc, s) => acc + s.detected, 0);
      const recall = total_expected === 0 ? 1 : total_detected / total_expected;
      const control_violations = fixtureScores.filter((s) => s.control_violation).length;
      const passing =
        recall >= level.thresholds.min_recall &&
        control_violations <= level.thresholds.max_control_violations;
      const fr = passing
        ? undefined
        : failureReason(recall, control_violations, level.thresholds, total_detected, total_expected);

      const result: LevelResult = {
        level: level.name,
        summary: level.summary,
        thresholds: level.thresholds,
        fixtures: fixtureScores,
        total_expected,
        total_detected,
        recall: Number(recall.toFixed(3)),
        control_violations,
        passing,
        failure_reason: fr,
      };
      levelResults.push(result);
      opts.onProgress?.({ type: "level_done", result });

      if (passing) {
        highest_passing_level = level.name;
      } else {
        if (!first_failing_level) first_failing_level = level.name;
        if (stopOnFail) break;
      }
    }
  } finally {
    await server.close();
    opts.onProgress?.({ type: "server_stopped" });
  }

  const next_actions: NextAction[] = levelResults
    .filter((l) => !l.passing)
    .flatMap((l) => buildNextActions(l));

  return {
    generated_at: new Date().toISOString(),
    provider: provider.name,
    model: provider.model,
    truth_version: truth.version,
    terminology: truth.terminology,
    levels: levelResults,
    highest_passing_level,
    first_failing_level,
    overall_passing: levelResults.length > 0 && levelResults.every((l) => l.passing),
    next_actions,
  };
}
