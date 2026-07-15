/**
 * Deterministic input→feedback latency from flow frame bursts. Each burst's
 * frames are pixel-diffed against the burst's first frame; the first frame
 * that visibly differs marks when the UI acknowledged the interaction.
 *
 * Limitation: feedback that completed entirely before the first frame
 * (< one burst interval, default 50ms) is invisible to this measurement —
 * continuing animation (spinners, transitions) still registers on later
 * frames, so "none" verdicts are trustworthy for missing loading feedback.
 */
import sharp from "sharp";
import type { FlowCaptureResult } from "./types.js";

export interface LatencyMeasurement {
  step_index: number;
  step_label: string;
  action: string;
  /** ms from the burst start to the first visually-changed frame; null = nothing changed. */
  feedback_ms: number | null;
  /** How long the burst watched for a change. */
  burst_window_ms: number;
  verdict: "instant" | "delayed" | "none";
}

/** Mean absolute grayscale delta (0–255) above which a frame counts as changed. */
export const FEEDBACK_DIFF_THRESHOLD = 1.0;
/** Perceived-instant ceiling (NN/g: <100ms feels immediate). */
export const INSTANT_MS = 100;

/** Interactions that should produce visible acknowledgment. */
const FEEDBACK_ACTIONS = new Set(["click", "type", "press"]);

export async function frameDiffScore(a: Buffer, b: Buffer): Promise<number> {
  const norm = (png: Buffer) =>
    sharp(png).resize(64, 64, { fit: "fill" }).grayscale().raw().toBuffer();
  const [ra, rb] = await Promise.all([norm(a), norm(b)]);
  let sum = 0;
  for (let i = 0; i < ra.length; i++) sum += Math.abs(ra[i] - rb[i]);
  return sum / ra.length;
}

export async function measureFeedbackLatency(capture: FlowCaptureResult): Promise<LatencyMeasurement[]> {
  const out: LatencyMeasurement[] = [];
  for (const step of capture.step_results) {
    if (!step.success) continue;
    if (!FEEDBACK_ACTIONS.has(step.step.do)) continue;
    if (step.frame_indices.length < 2) continue;

    const frames = step.frame_indices
      .map((i) => capture.frames[i])
      .filter(Boolean)
      .sort((a, b) => a.t_offset_ms - b.t_offset_ms);
    if (frames.length < 2) continue;

    const base = frames[0];
    let feedback_ms: number | null = null;
    for (const f of frames.slice(1)) {
      if ((await frameDiffScore(base.png, f.png)) > FEEDBACK_DIFF_THRESHOLD) {
        feedback_ms = f.t_offset_ms - base.t_offset_ms;
        break;
      }
    }

    out.push({
      step_index: step.step_index,
      step_label: frames[0].step_label,
      action: step.step.do,
      feedback_ms,
      burst_window_ms: frames[frames.length - 1].t_offset_ms - base.t_offset_ms,
      verdict: feedback_ms === null ? "none" : feedback_ms <= INSTANT_MS ? "instant" : "delayed",
    });
  }
  return out;
}
