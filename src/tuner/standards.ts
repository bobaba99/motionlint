/**
 * Emil Kowalski's animation standards, encoded as machine-checkable constants.
 *
 * Distilled from https://emilkowal.ski/ and the review-animations / improve-animations
 * skills. These are the exact values the linter cites in findings — never approximate
 * one; copy it from here so every finding points at the same source of truth.
 */

/** Strong custom easing curves. Built-in CSS easings are too weak for deliberate UI motion. */
export const EASING_CURVES = {
  /** Strong ease-out for UI — entrances/exits. Starts fast, feels responsive. */
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  /** Strong ease-in-out for on-screen movement / morphing. */
  easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  /** iOS-like drawer curve (Ionic). */
  drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
} as const;

/**
 * Duration budgets in milliseconds. UI animations stay under 300ms — a 180ms dropdown
 * feels more responsive than a 400ms one. Exits run ~20% faster than their entrance.
 */
export const DURATION = {
  /** Hard ceiling for any UI animation. Above this is always a finding. */
  uiMaxMs: 300,
  /** Button / press feedback. */
  pressMs: [100, 160] as const,
  /** Tooltips, small popovers. */
  tooltipMs: [125, 200] as const,
  /** Dropdowns, selects. */
  dropdownMs: [150, 250] as const,
  /** Modals, drawers — the one UI family allowed past 300ms. */
  modalMs: [200, 500] as const,
  /** Exits should be this fraction faster than the matching entrance. */
  exitSpeedup: 0.2,
} as const;

/** Physicality: nothing in the real world appears from nothing. */
export const SCALE = {
  /** Never scale below this on an entrance. `scale(0)` is always a finding. */
  minEntranceScale: 0.9,
  /** Recommended entrance-scale floor (0.9–0.97 is the healthy band). */
  recommendedEntranceScale: 0.95,
  /** Press-feedback scale (subtle, 0.95–0.98). */
  pressScale: 0.97,
} as const;

/** Stagger between grouped item entrances. Longer than this feels slow. */
export const STAGGER = { minMs: 30, maxMs: 80 } as const;

/**
 * Easing decision order — what curve a given motion role should use.
 * Mirrors the review-animations STANDARDS "Easing" section.
 */
export const EASING_RULES = {
  entering: "ease-out",
  exiting: "ease-out",
  moving: "ease-in-out",
  hover: "ease",
  constant: "linear",
  default: "ease-out",
} as const;

/**
 * The tuner's easing presets. The Emil curves lead; the softer/decorative options
 * follow. Consumed by both the tuner UI and the linter's suggested-fix text.
 */
export interface EasingPreset {
  name: string;
  value: string;
  description: string;
  /** Emil-endorsed curve for standard UI motion. */
  recommended?: boolean;
}

export const EMIL_EASING_PRESETS: EasingPreset[] = [
  { name: "ease-out (Emil)", value: EASING_CURVES.easeOut, description: "Strong ease-out for UI — entrances & exits. The default.", recommended: true },
  { name: "ease-in-out (Emil)", value: EASING_CURVES.easeInOut, description: "Strong ease-in-out for on-screen movement / morphing.", recommended: true },
  { name: "drawer (iOS)", value: EASING_CURVES.drawer, description: "iOS-like drawer curve — bottom sheets, side panels." },
  { name: "spring (snappy)", value: "cubic-bezier(.34,1.56,.64,1)", description: "Slight overshoot — playful entrances." },
  { name: "spring (bouncy)", value: "cubic-bezier(.68,-.55,.27,1.55)", description: "Pronounced bounce — drag-to-dismiss only." },
  { name: "ease", value: "ease", description: "Browser default — acceptable for hover / colour only." },
  { name: "linear", value: "linear", description: "Constant speed — marquees, progress, spinners." },
];

/** Regexes that identify a CSS/JS easing keyword as `ease-in` (banned on UI). */
export function isEaseIn(timing: string): boolean {
  const t = timing.trim().toLowerCase();
  if (t === "ease-in") return true;
  // ease-in cubic-beziers accelerate from rest: first control-point y ≈ 0 and x > 0.
  const m = t.match(/cubic-bezier\(\s*([\d.]+)\s*,\s*(-?[\d.]+)\s*,/);
  if (m) {
    const x1 = Number(m[1]);
    const y1 = Number(m[2]);
    // Accelerating-in shape: noticeable horizontal lead-in with ~no vertical rise.
    if (x1 >= 0.3 && y1 <= 0.05) return true;
  }
  return false;
}

/** A "weak" built-in easing that Emil flags as too soft for deliberate entrance/exit motion. */
export function isWeakBuiltin(timing: string): boolean {
  const t = timing.trim().toLowerCase();
  return t === "ease" || t === "ease-out" || t === "linear" || t === "cubic-bezier(0.25, 0.1, 0.25, 1)";
}
