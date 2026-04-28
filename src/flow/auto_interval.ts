import { extractAnimations } from "../tuner/extract.js";

const ABSOLUTE_FLOOR_MS = 20;     // setTimeout granularity floor
const DEFAULT_FALLBACK_MS = 50;   // matches the system default
const ABSOLUTE_CEILING_MS = 100;  // never recommend slower than the human-detection threshold

/**
 * Scans the page's animations (CSS transitions/keyframes + Motion/GSAP/anime/auto-animate
 * library calls) and recommends an inter-frame burst interval. The rule of
 * thumb is: capture at least 4 frames during the shortest animation, so the
 * LLM sees the easing curve, not just before/after.
 *
 * Returns the recommended interval in ms, clamped to [20, 100]. Always falls
 * back to 50ms when the page has no detected animations.
 */
export async function recommendIntervalMs(url: string): Promise<{ interval_ms: number; reasoning: string; min_animation_ms: number | null; sampled: number }> {
  let detected;
  try {
    detected = await extractAnimations({ url, settleMs: 1500 });
  } catch (err) {
    return {
      interval_ms: DEFAULT_FALLBACK_MS,
      reasoning: `Animation scan failed (${(err as Error).message}); using default ${DEFAULT_FALLBACK_MS}ms.`,
      min_animation_ms: null,
      sampled: 0,
    };
  }

  // Pull duration values from each detected animation's params.
  const durations: number[] = [];
  for (const a of detected.animations) {
    for (const p of a.params) {
      if (p.name === "duration" && p.unit === "ms" && p.value > 0) {
        durations.push(p.value);
      }
    }
  }

  if (durations.length === 0) {
    return {
      interval_ms: DEFAULT_FALLBACK_MS,
      reasoning: `No animations with parsable durations detected on the page; using default ${DEFAULT_FALLBACK_MS}ms.`,
      min_animation_ms: null,
      sampled: detected.animations.length,
    };
  }

  durations.sort((a, b) => a - b);
  const minDuration = durations[0];
  // Aim for 4 frames during the shortest animation, then clamp.
  let interval = Math.round(minDuration / 4);
  interval = Math.max(ABSOLUTE_FLOOR_MS, Math.min(ABSOLUTE_CEILING_MS, interval));

  return {
    interval_ms: interval,
    reasoning: `Shortest detected animation: ${minDuration}ms across ${durations.length} animation(s). Picking ${interval}ms = floor(min/4), clamped to [${ABSOLUTE_FLOOR_MS}, ${ABSOLUTE_CEILING_MS}].`,
    min_animation_ms: minDuration,
    sampled: detected.animations.length,
  };
}
