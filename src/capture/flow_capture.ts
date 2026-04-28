import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import type { FlowSpec, FlowStep, FlowStepResult, FlowCaptureResult, CapturedFrame } from "../flow/types.js";

const DEFAULT_VIEWPORT = { name: "desktop", width: 1440, height: 900 };
// 16 frames over 750ms = 50ms inter-frame interval — half the 100ms human
// detection threshold and below the ~16.7ms-per-frame industry minimum at
// 60fps. CDP captureScreenshot at JPEG q85 takes ~8ms per shot so 50ms
// intervals are easily achievable.
const DEFAULT_BURST_MS = 750;
const DEFAULT_BURST_FRAMES = 16;
const DEFAULT_BURST_STRATEGY: BurstStrategy = "screencast";

export type BurstStrategy = "screencast" | "screenshot";

export interface FlowCaptureOptions {
  spec: FlowSpec;
  /** Where to save the video (.webm). Set to undefined to skip recording. */
  videoDir?: string;
  /** How long to wait after most actions before the implicit capture burst. Default 200ms. */
  postActionDelayMs?: number;
  /** Take an implicit capture burst after every interactive step (click/type/hover/scroll/press). Default true. */
  captureAfterEveryInteraction?: boolean;
  /** Capture full-page screenshots in burst frames. Only honoured when
      burstStrategy === "screenshot" (CDP screencast is viewport-only by design). */
  burstFullPage?: boolean;
  /** How to capture the per-burst frames.
      - "screencast" (default): CDP `Page.startScreencast` streams JPEG frames at
        Chrome's native compositor frame rate (~30fps, ~33ms intervals). Sub-100ms
        intervals are achievable. Viewport-only by definition.
      - "screenshot": serialised `page.screenshot()` calls. Slower (~150-200ms per
        frame) but supports full-page captures via `burstFullPage: true`.
   */
  burstStrategy?: BurstStrategy;
}

/**
 * Runs a flow spec against a real Chromium instance and captures:
 *  - Per `capture` step (and optionally after every interaction): a burst of
 *    N frames over `burst_ms` so the LLM can see animation states.
 *  - The full Playwright video of the run.
 *
 * Frames are PNG buffers; the contact-sheet compositor turns them into a
 * single labelled image for the vision model.
 */
export async function runFlowCapture(opts: FlowCaptureOptions): Promise<FlowCaptureResult> {
  const { spec } = opts;
  const viewport = spec.viewport ?? DEFAULT_VIEWPORT;
  const captureAfterEvery = opts.captureAfterEveryInteraction !== false;
  const postActionDelay = opts.postActionDelayMs ?? 200;
  const burstFullPage = opts.burstFullPage ?? false;
  const burstStrategy: BurstStrategy = opts.burstStrategy ?? DEFAULT_BURST_STRATEGY;

  if (opts.videoDir) await mkdir(opts.videoDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    recordVideo: opts.videoDir
      ? { dir: opts.videoDir, size: { width: viewport.width, height: viewport.height } }
      : undefined,
  });
  const page = await context.newPage();

  const t0 = Date.now();
  const frames: CapturedFrame[] = [];
  const stepResults: FlowStepResult[] = [];

  let videoPath: string | undefined;

  try {
    // Always navigate to the base URL first.
    await page.goto(spec.url, { waitUntil: "networkidle", timeout: 15_000 });
    // small settle
    await page.waitForTimeout(300);

    for (let i = 0; i < spec.steps.length; i++) {
      const step = spec.steps[i];
      const result: FlowStepResult = {
        step_index: i,
        step,
        t_start_ms: Date.now() - t0,
        t_end_ms: 0,
        success: true,
        frame_indices: [],
      };

      try {
        const wantsBurst = step.do === "capture" || (captureAfterEvery && step.do !== "wait");

        await runAction(page, step, spec);

        if (
          postActionDelay > 0 &&
          step.do !== "wait" &&
          step.do !== "capture" &&
          // For scroll, skip the delay — the scroll animation runs concurrently
          // with the burst, so we want to capture from t=0.
          step.do !== "scroll"
        ) {
          await page.waitForTimeout(postActionDelay);
        }

        if (wantsBurst) {
          // Spec-level burst defaults — step-level frames/burst_ms still win.
          const effectiveStep = applySpecDefaults(step, spec);
          const burstFrames = burstStrategy === "screencast"
            ? await captureBurstViaScreencast(context, page, i, effectiveStep)
            : await captureBurstViaScreenshot(page, i, effectiveStep, burstFullPage);
          result.frame_indices = burstFrames.map((_, j) => frames.length + j);
          frames.push(...burstFrames);
        }
      } catch (err) {
        result.success = false;
        result.error = (err as Error).message;
      } finally {
        result.t_end_ms = Date.now() - t0;
        stepResults.push(result);
      }
    }
  } finally {
    if (opts.videoDir) {
      try {
        videoPath = await page.video()?.path();
      } catch { /* ignore */ }
    }
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return {
    spec,
    video_path: videoPath,
    frames,
    total_duration_ms: Date.now() - t0,
    step_results: stepResults,
  };
}

async function runAction(page: Page, step: FlowStep, spec: FlowSpec): Promise<void> {
  switch (step.do) {
    case "navigate": {
      const target = step.value ?? "";
      const fullUrl = /^https?:\/\//i.test(target) ? target : new URL(target || "/", spec.url).toString();
      await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 10_000 });
      break;
    }
    case "click":
      if (!step.selector) throw new Error("click missing selector");
      await page.click(step.selector, { timeout: 5_000 });
      break;
    case "hover":
      if (!step.selector) throw new Error("hover missing selector");
      await page.hover(step.selector, { timeout: 5_000 });
      break;
    case "type":
      if (!step.selector) throw new Error("type missing selector");
      await page.fill(step.selector, step.value ?? "", { timeout: 5_000 });
      break;
    case "press":
      await page.keyboard.press(step.value ?? "Enter");
      break;
    case "scroll":
      // Animate the scroll over the burst window via requestAnimationFrame so
      // the per-step burst captures the in-flight motion (and any scroll-driven
      // animations: parallax, IntersectionObserver reveals, scroll-progress bars).
      // We don't await — the page-side animation runs concurrently with the
      // upcoming burst capture.
      await page.evaluate(({ px, dur }) => {
        const start = window.scrollY;
        const delta = Number(px) || 600;
        const t0 = performance.now();
        function tick(now: number): void {
          const t = Math.min(1, (now - t0) / dur);
          // ease-out cubic — matches what most websites use for scroll-jacking.
          const eased = 1 - Math.pow(1 - t, 3);
          window.scrollTo(0, start + delta * eased);
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }, { px: Number(step.ms ?? 600), dur: Number(step.burst_ms ?? DEFAULT_BURST_MS) });
      break;
    case "wait":
      await page.waitForTimeout(step.ms ?? 500);
      break;
    case "capture":
      // capture is its own no-op; the burst is taken by runFlowCapture's loop
      break;
  }
}

/**
 * Take N PNG screenshots over `burst_ms`. Each capture is sub-100ms on
 * a fast machine, so this captures real animation states.
 */
/**
 * Legacy / fallback strategy. Serialised page.screenshot() calls — ~150-200ms
 * per frame on a typical dev machine. Used when burstStrategy="screenshot" or
 * when the user explicitly needs full-page captures inside a burst.
 */
async function captureBurstViaScreenshot(
  page: Page,
  stepIndex: number,
  step: FlowStep,
  burstFullPage: boolean,
): Promise<CapturedFrame[]> {
  const N = Math.max(2, Math.min(16, step.frames ?? DEFAULT_BURST_FRAMES));
  const total = Math.max(120, step.burst_ms ?? DEFAULT_BURST_MS);
  const interval = total / (N - 1);

  const out: CapturedFrame[] = [];
  const t0 = Date.now();
  for (let j = 0; j < N; j++) {
    const tOffset = Date.now() - t0;
    const png = await page.screenshot({ type: "png", fullPage: burstFullPage });
    out.push({
      step_index: stepIndex,
      step_label: step.label || actionLabel(step),
      frame_index: j,
      t_offset_ms: tOffset,
      png,
    });
    if (j < N - 1) {
      const elapsed = Date.now() - t0;
      const targetForNext = (j + 1) * interval;
      const sleep = Math.max(0, targetForNext - elapsed);
      if (sleep > 0) await page.waitForTimeout(sleep);
    }
  }
  return out;
}

/**
 * High-frame-rate burst via CDP `Page.captureScreenshot` (JPEG q85). Measured
 * at ~8ms per shot — sub-100ms intervals are trivially achievable. We poll at
 * the requested cadence so the frames are evenly spaced across the burst
 * window, instead of relying on Chrome's compositor to push frames (which
 * goes silent on static pages — the streaming screencast approach we tried
 * earlier suffered from this).
 *
 * The `screencast` name is kept as the public option label because that's
 * what users searching for "high-frame-rate browser capture" will look for;
 * the underlying mechanism is CDP-poll, which is faster anyway.
 */
async function captureBurstViaScreencast(
  context: BrowserContext,
  page: Page,
  stepIndex: number,
  step: FlowStep,
): Promise<CapturedFrame[]> {
  const N = Math.max(2, Math.min(16, step.frames ?? DEFAULT_BURST_FRAMES));
  const total = Math.max(120, step.burst_ms ?? DEFAULT_BURST_MS);
  const interval = total / (N - 1);

  const cdp: CDPSession = await context.newCDPSession(page);
  const out: CapturedFrame[] = [];
  const t0 = Date.now();

  try {
    for (let j = 0; j < N; j++) {
      const tOffset = Date.now() - t0;
      // CDP captureScreenshot is dramatically faster than page.screenshot()
      // because it bypasses Playwright's serialization layer and goes directly
      // to the browser's screenshot pipeline. JPEG q85 keeps the encode under
      // 10ms on typical hardware.
      const result = await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 85,
        captureBeyondViewport: false,
      });
      out.push({
        step_index: stepIndex,
        step_label: step.label || actionLabel(step),
        frame_index: j,
        t_offset_ms: tOffset,
        png: Buffer.from(result.data, "base64"),
      });
      if (j < N - 1) {
        const elapsed = Date.now() - t0;
        const target = (j + 1) * interval;
        const sleep = Math.max(0, target - elapsed);
        if (sleep > 0) await page.waitForTimeout(sleep);
      }
    }
  } finally {
    await cdp.detach().catch(() => {});
  }

  return out;
}

/**
 * Apply spec-level burst defaults (interval/window) to a step that hasn't
 * specified its own. Honours step-level overrides.
 *
 * Precedence (highest first):
 *   1. step.frames / step.burst_ms (per-step override)
 *   2. spec.burst_interval_ms / spec.burst_ms (whole-flow default)
 *   3. DEFAULT_BURST_FRAMES / DEFAULT_BURST_MS (50ms intervals)
 */
function applySpecDefaults(step: FlowStep, spec: FlowSpec): FlowStep {
  if (step.frames !== undefined && step.burst_ms !== undefined) return step;
  const burstMs = step.burst_ms ?? spec.burst_ms ?? DEFAULT_BURST_MS;
  let frames = step.frames;
  if (frames === undefined) {
    if (spec.burst_interval_ms && spec.burst_interval_ms > 0) {
      const interval = Math.max(20, Math.min(500, spec.burst_interval_ms));
      frames = Math.max(2, Math.min(20, Math.round(burstMs / interval) + 1));
    } else {
      frames = DEFAULT_BURST_FRAMES;
    }
  }
  return { ...step, frames, burst_ms: burstMs };
}

function actionLabel(step: FlowStep): string {
  switch (step.do) {
    case "navigate": return `navigate ${step.value ?? ""}`;
    case "click":    return `click ${step.selector ?? ""}`;
    case "hover":    return `hover ${step.selector ?? ""}`;
    case "type":     return `type ${step.selector ?? ""}`;
    case "scroll":   return `scroll ${step.ms ?? 600}px`;
    case "press":    return `press ${step.value ?? "Enter"}`;
    case "wait":     return `wait ${step.ms ?? 500}ms`;
    case "capture":  return "capture";
  }
}
