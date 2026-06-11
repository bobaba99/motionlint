import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, isAbsolute, relative } from "node:path";
import { buildContactSheet } from "../capture/contact_sheet.js";
import { runFlowCapture } from "../capture/flow_capture.js";
import { buildFlowPrompt } from "../analysis/flow_prompt.js";
import { resolveProvider } from "../providers/resolver.js";
import { SelfConsistencyProvider } from "../providers/consistency.js";
import type { FlowSpec, FlowReport } from "./types.js";

export interface RunFlowOptions {
  spec: FlowSpec;
  provider?: string;
  model?: string | null;
  consistency?: number;
  /** Where to put the contact sheet PNG. */
  artifactDir?: string;
  /** Where to put the recorded video. Set to undefined to skip recording. */
  videoDir?: string;
  /** Disable the "burst after every interaction" default. */
  noImplicitBursts?: boolean;
  /** Capture full-page in each burst frame instead of viewport-only. Slower; only honoured for the screenshot strategy. */
  burstFullPage?: boolean;
  /** "screencast" (default, ~33ms intervals via CDP) or "screenshot" (legacy ~150-200ms). */
  burstStrategy?: "screencast" | "screenshot";
  /** Optional path to a team preferences markdown file (motion philosophy, inspirations). */
  preferencesPath?: string;
  onProgress?: (event: FlowProgress) => void;
}

export type FlowProgress =
  | { type: "provider_resolved"; name: string; model: string }
  | { type: "capture_started" }
  | { type: "step_done"; step_index: number; success: boolean; frames_captured: number }
  | { type: "capture_finished"; total_frames: number; duration_ms: number }
  | { type: "contact_sheet_built"; path: string }
  | { type: "analysis_started" }
  | { type: "analysis_finished" };

export async function ensureDir(p: string | undefined): Promise<string | undefined> {
  if (p) await mkdir(p, { recursive: true });
  return p;
}

function flowSlug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "flow";
}

export async function runFlow(opts: RunFlowOptions): Promise<FlowReport> {
  const artifactDir = opts.artifactDir ?? ".motionlint/flows";
  const videoDir = opts.videoDir;

  let provider = await resolveProvider({
    provider: opts.provider,
    model: opts.model ?? null,
  });
  if (opts.consistency && opts.consistency > 1) {
    provider = new SelfConsistencyProvider(provider, { samples: opts.consistency });
  }
  opts.onProgress?.({ type: "provider_resolved", name: provider.name, model: provider.model });

  opts.onProgress?.({ type: "capture_started" });
  const capture = await runFlowCapture({
    spec: opts.spec,
    videoDir: await ensureDir(videoDir),
    captureAfterEveryInteraction: !opts.noImplicitBursts,
    burstFullPage: opts.burstFullPage ?? false,
    burstStrategy: opts.burstStrategy ?? "screencast",
  });

  for (const r of capture.step_results) {
    opts.onProgress?.({
      type: "step_done",
      step_index: r.step_index,
      success: r.success,
      frames_captured: r.frame_indices.length,
    });
  }
  opts.onProgress?.({ type: "capture_finished", total_frames: capture.frames.length, duration_ms: capture.total_duration_ms });

  // Build the contact sheet.
  const sheetBuf = await buildContactSheet(capture.frames);
  await mkdir(artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = flowSlug(opts.spec.name);
  const sheetPath = join(artifactDir, `${slug}-${stamp}.png`);
  await writeFile(sheetPath, sheetBuf);
  capture.contact_sheet_path = sheetPath;
  opts.onProgress?.({ type: "contact_sheet_built", path: sheetPath });

  // Load team preferences (if any) — fed into the prompt AND embedded in the report.
  let preferencesMd: string | undefined;
  if (opts.preferencesPath) {
    try {
      preferencesMd = await readFile(opts.preferencesPath, "utf8");
    } catch (err) {
      console.error(`[motionlint] could not read preferences file ${opts.preferencesPath}: ${(err as Error).message}`);
    }
  }

  // Analyze.
  opts.onProgress?.({ type: "analysis_started" });
  const prompt = buildFlowPrompt({
    spec: opts.spec,
    step_results: capture.step_results,
    preferences_md: preferencesMd,
  });
  const analysis = await provider.analyze(sheetBuf, prompt, "flow");
  opts.onProgress?.({ type: "analysis_finished" });

  return {
    generated_at: new Date().toISOString(),
    flow_name: opts.spec.name,
    url: opts.spec.url,
    provider: provider.name,
    model: provider.model,
    capture,
    analysis,
    contact_sheet_path: sheetPath,
    video_path: capture.video_path,
    preferences_md: preferencesMd,
    preferences_path: opts.preferencesPath,
  };
}

export function relPath(target: string | undefined, fromDir: string): string | undefined {
  if (!target) return undefined;
  if (!isAbsolute(target)) return target;
  return relative(fromDir, target) || target;
}

export function reportFilenameForFlow(spec: FlowSpec, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `flow-${flowSlug(spec.name)}-${stamp}.${ext}`;
}

export { dirname };
