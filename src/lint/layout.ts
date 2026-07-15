/**
 * Deterministic layout linter: converts DomSnapshot measurements (already
 * captured for every review) into cited findings. No LLM, no extra probing —
 * the numbers were measured by src/capture/dom.ts on the live page.
 */
import type { DomSnapshot } from "../capture/dom.js";
import type { IssueSeverity } from "../types.js";

export type LayoutFindingCategory =
  | "tap_target"
  | "typography"
  | "overflow"
  | "contrast"
  | "cohesion"
  | "content";

export interface LayoutFinding {
  category: LayoutFindingCategory;
  severity: IssueSeverity;
  title: string;
  /** What is wrong (concrete, with the measured value). */
  detail: string;
  /** User impact, one sentence. */
  why: string;
  /** Specific, actionable fix. */
  fix: string;
  /** The standard cited (WCAG / HIG / house rule). */
  standard: string;
  /** Where on the page (element text or selector). */
  location: string;
}

export interface LayoutAudit {
  url: string;
  findings: LayoutFinding[];
  critical_count: number;
  warning_count: number;
  suggestion_count: number;
  /** 0–100, house weights: critical 25 / warning 10 / suggestion 3. */
  score: number;
}

export const TAP_TARGET_MIN_PX = 44;
export const BODY_FONT_MIN_PX = 16;
export const TEXT_FLOOR_PX = 12;
export const CONTRAST_MIN_RATIO = 4.5;
export const TYPE_SIZE_MAX = 8;

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 0, warning: 1, suggestion: 2 };

export function lintLayout(s: DomSnapshot): LayoutFinding[] {
  const findings: LayoutFinding[] = [];

  if (s.horizontal_overflow) {
    findings.push({
      category: "overflow",
      severity: "critical",
      title: "Page overflows horizontally",
      detail: `The document is ${s.overflow_amount_px}px wider than the viewport.`,
      why: "Horizontal scroll on a vertical page reads as broken layout and hides content.",
      fix: "Find the overflowing element (often a fixed-width image, table, or negative margin) and constrain it with max-width: 100% or overflow-x: auto on its container.",
      standard: "No unintended horizontal scroll at any supported viewport",
      location: "document",
    });
  }

  for (const t of s.small_tap_targets) {
    findings.push({
      category: "tap_target",
      severity: "warning",
      title: "Tap target below the 44px floor",
      detail: `<${t.tag}> "${t.text}" measures ${Math.round(t.rect.w)}x${Math.round(t.rect.h)}px (${t.reason}).`,
      why: "Small targets cause mis-taps, especially one-handed on mobile.",
      fix: `Grow the hit area to at least ${TAP_TARGET_MIN_PX}px in both dimensions — padding counts, visual size doesn't have to change.`,
      standard: `Tap targets ≥ ${TAP_TARGET_MIN_PX}px (WCAG 2.5.8, Apple HIG 44pt)`,
      location: t.text || `<${t.tag}>`,
    });
  }

  if (s.body_font_px !== null && s.body_font_px < BODY_FONT_MIN_PX) {
    findings.push({
      category: "typography",
      severity: "suggestion",
      title: "Body text below 16px",
      detail: `Body copy computes to ${s.body_font_px}px.`,
      why: "Sub-16px body text reduces readability for users over 35 and on high-DPI screens.",
      fix: `Bump body copy to ${BODY_FONT_MIN_PX}px / line-height 1.5; reserve 14px for captions only.`,
      standard: `Body text ≥ ${BODY_FONT_MIN_PX}px`,
      location: "body copy",
    });
  }

  if (s.smallest_text !== null && s.smallest_text.px < TEXT_FLOOR_PX) {
    findings.push({
      category: "typography",
      severity: "warning",
      title: `Text below the ${TEXT_FLOOR_PX}px floor`,
      detail: `Smallest rendered text is ${s.smallest_text.px}px ("${s.smallest_text.sample}").`,
      why: "Text this small is illegible for a large share of users and fails zoom expectations.",
      fix: `Raise it to at least ${TEXT_FLOOR_PX}px, or cut the copy if it isn't worth reading.`,
      standard: `No rendered text below ${TEXT_FLOOR_PX}px`,
      location: s.smallest_text.sample,
    });
  }

  for (const pair of s.computed_color_pairs_under_threshold) {
    findings.push({
      category: "contrast",
      severity: "warning",
      title: "Text contrast under 4.5:1",
      detail: `"${pair.text}" estimates ${pair.ratio_estimate}:1 against its background.`,
      why: "Low-contrast text is unreadable in sunlight and for low-vision users.",
      fix: "Darken the text or lighten the background until the ratio clears 4.5:1 (large text may use 3:1).",
      standard: `Text contrast ≥ ${CONTRAST_MIN_RATIO}:1 (WCAG 1.4.3 AA)`,
      location: pair.text,
    });
  }

  if (s.type_size_count > TYPE_SIZE_MAX) {
    findings.push({
      category: "cohesion",
      severity: "suggestion",
      title: "Type-size sprawl",
      detail: `${s.type_size_count} distinct font sizes render on this page.`,
      why: "A sprawling type scale reads as unintentional and weakens hierarchy.",
      fix: `Consolidate to a deliberate scale (≤ ${TYPE_SIZE_MAX} sizes is the healthy band).`,
      standard: `≤ ${TYPE_SIZE_MAX} distinct type sizes per page`,
      location: "document",
    });
  }

  for (const empty of s.empty_lists) {
    findings.push({
      category: "content",
      severity: "suggestion",
      title: "Empty list container",
      detail: `${empty.selector} renders ${Math.round(empty.rect.w)}x${Math.round(empty.rect.h)}px with no items.`,
      why: "An empty region reads as a bug; an empty state is an invitation to act.",
      fix: "Render an explicit empty state (message + next action) when the list has no items.",
      standard: "Empty states are designed, not blank",
      location: empty.selector,
    });
  }

  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function auditLayout(s: DomSnapshot): LayoutAudit {
  const findings = lintLayout(s);
  const critical_count = findings.filter((f) => f.severity === "critical").length;
  const warning_count = findings.filter((f) => f.severity === "warning").length;
  const suggestion_count = findings.filter((f) => f.severity === "suggestion").length;
  const penalty = critical_count * 25 + warning_count * 10 + suggestion_count * 3;
  return {
    url: s.url,
    findings,
    critical_count,
    warning_count,
    suggestion_count,
    score: Math.max(0, 100 - penalty),
  };
}
