/**
 * Deterministic animation linter.
 *
 * Runs the values harvested by the tuner (real transition/keyframe/GSAP durations,
 * easing curves, transforms) against Emil Kowalski's animation standards — no vision
 * model required. Every finding cites the exact standard it violates.
 */
import type { IssueSeverity } from "../types.js";
import type { DetectedAnimation, TunerCapture } from "./types.js";
import { DURATION, EASING_CURVES, SCALE, STAGGER, isEaseIn, isWeakBuiltin } from "./standards.js";

export type AnimationFindingCategory =
  | "easing"
  | "duration"
  | "physicality"
  | "performance"
  | "accessibility"
  | "cohesion";

export interface AnimationFinding {
  anim_id: string;
  selector: string;
  common_name: string;
  category: AnimationFindingCategory;
  severity: IssueSeverity;
  title: string;
  /** What is wrong (concrete). */
  detail: string;
  /** User-impact, one sentence. */
  why: string;
  /** Specific, actionable fix. */
  fix: string;
  /** The Emil standard cited. */
  standard: string;
  /** Current value (the "before"). */
  current?: string;
  /** Suggested value (the "after"). */
  suggested?: string;
}

export interface AnimationAudit {
  url: string;
  captured_at: string;
  viewport: { width: number; height: number };
  total_animations: number;
  findings: AnimationFinding[];
  critical_count: number;
  warning_count: number;
  suggestion_count: number;
  /** 0–100. 100 = every checked animation is clean. */
  score: number;
}

/** Layout-triggering properties — animating these forces layout + paint off the GPU. */
const LAYOUT_PROPS = ["width", "height", "margin", "padding", "top", "left", "right", "bottom"];

function rawParams(anim: DetectedAnimation): Record<string, unknown> {
  const raw = (anim.raw ?? {}) as Record<string, unknown>;
  return (raw.params ?? {}) as Record<string, unknown>;
}

function durationMs(anim: DetectedAnimation): number | null {
  const p = (anim.params ?? []).find((x) => x.name === "duration");
  return p ? p.value : null;
}

function delayMs(anim: DetectedAnimation): number | null {
  const p = (anim.params ?? []).find((x) => x.name === "delay");
  return p ? p.value : null;
}

function keyframesName(anim: DetectedAnimation): string | null {
  const p = rawParams(anim);
  return typeof p.name === "string" && p.name ? p.name : null;
}

/**
 * Selector with sibling indices stripped — `li.item:nth-of-type(3)` and
 * `li.item:nth-of-type(7)` normalize to the same string, so structural
 * siblings compare equal while unrelated components stay distinct.
 */
function normalizedSelector(anim: DetectedAnimation): string {
  return anim.selector.replace(/:nth-of-type\(\d+\)/g, "");
}

/** True median: averages the two middle values for even-length inputs. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function timingFunction(anim: DetectedAnimation): string | null {
  const p = rawParams(anim);
  const t = p.timing ?? p.easing;
  return typeof t === "string" ? t : null;
}

/** Only CSS transitions/keyframes carry a `property`; JS libs animate whatever the tween sets. */
function transitionProperty(anim: DetectedAnimation): string | null {
  const p = rawParams(anim);
  return typeof p.property === "string" ? p.property : null;
}

function iterationCount(anim: DetectedAnimation): string | null {
  const p = rawParams(anim);
  return typeof p.iteration === "string" ? p.iteration : null;
}

/** Heuristic: an animation whose element reads like an entrance / reveal / modal / toast. */
function looksLikeEntrance(anim: DetectedAnimation): boolean {
  const hay = `${anim.common_name} ${anim.selector} ${anim.technical_name}`.toLowerCase();
  return /(modal|dialog|drawer|sheet|toast|popover|dropdown|tooltip|menu|card|hero|reveal|fade|enter|appear|slide)/.test(hay);
}

function looksLikeModal(anim: DetectedAnimation): boolean {
  const hay = `${anim.common_name} ${anim.selector}`.toLowerCase();
  return /(modal|dialog|drawer|sheet|overlay)/.test(hay);
}

function looksLikeHover(anim: DetectedAnimation): boolean {
  const prop = (transitionProperty(anim) ?? "").toLowerCase();
  const hay = `${anim.common_name} ${anim.selector}`.toLowerCase();
  return /(hover|link|nav|button|btn|color|background)/.test(hay) || /color|background/.test(prop);
}

/** Pull the body of a specific `@keyframes <name> { … }` block out of a stylesheet. */
function keyframesBlock(css: string, name: string): string | null {
  if (!name) return null;
  // Escape the name for use in a RegExp, then match its @keyframes block non-greedily.
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(?:-webkit-)?keyframes\\s+${safe}\\s*\\{([\\s\\S]*?)\\}\\s*\\}`, "i");
  const m = css.match(re);
  return m ? m[1] : null;
}

// scale(0), scale(0.0), scale(.0), scale3d(0,…), scale: 0 — but never scale(0.95).
const SCALE_ZERO = /\bscale3?d?\(\s*(?:0(?:\.0+)?|\.0+)\s*[,)]/;
const SCALE_ZERO_PROP = /\bscale\s*:\s*(?:0(?:\.0+)?|\.0+)\b/;

/**
 * Detect a genuine scale-from-0 entrance using only per-element signals — never a
 * whole-stylesheet scan, which would attribute any page-wide `scale(0)` to this
 * element. Reliable signals: a JS tween's own `scale: 0` var, or a `scale(0)` inside
 * this animation's own named `@keyframes` block.
 */
function hasScaleFromZero(anim: DetectedAnimation): boolean {
  const raw = rawParams(anim);
  const vars = (raw.vars ?? raw) as Record<string, unknown>;
  if (vars && (vars.scale === 0 || vars.scale === "0")) return true;

  if (anim.source === "css-keyframes" && typeof raw.name === "string") {
    const block = keyframesBlock(anim.preview_css ?? "", raw.name);
    if (block && (SCALE_ZERO.test(block) || SCALE_ZERO_PROP.test(block))) return true;
  }
  return false;
}

function severityRank(s: IssueSeverity): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : 2;
}

/** Lint a single detected animation against the standards. */
export function lintAnimation(anim: DetectedAnimation): AnimationFinding[] {
  const findings: AnimationFinding[] = [];
  const base = { anim_id: anim.id, selector: anim.selector, common_name: anim.common_name };

  const timing = timingFunction(anim);
  const dur = durationMs(anim);
  const prop = transitionProperty(anim);
  const isEntrance = looksLikeEntrance(anim);

  // — Easing: ease-in on UI is always a finding —
  if (timing && isEaseIn(timing)) {
    findings.push({
      ...base,
      category: "easing",
      severity: "warning",
      title: "ease-in on UI motion",
      detail: `Uses \`${timing}\`, which starts slow and delays the exact moment the user is watching.`,
      why: "ease-out at the same duration feels faster because it responds immediately; ease-in feels laggy.",
      fix: `Switch to a strong ease-out: \`${EASING_CURVES.easeOut}\`.`,
      standard: "Never `ease-in` on UI. Entering/exiting → ease-out.",
      current: timing,
      suggested: EASING_CURVES.easeOut,
    });
  } else if (timing && isEntrance && isWeakBuiltin(timing)) {
    // — Easing: weak built-in curve on a deliberate entrance —
    const role = looksLikeHover(anim) ? "hover" : "entrance";
    if (role !== "hover") {
      findings.push({
        ...base,
        category: "easing",
        severity: "suggestion",
        title: "Weak built-in easing on an entrance",
        detail: `\`${timing}\` is too soft for a deliberate ${role}. Built-in CSS easings barely accelerate.`,
        why: "A stronger curve reads as intentional and responsive rather than generic.",
        fix: `Use a strong ease-out token: \`${EASING_CURVES.easeOut}\`.`,
        standard: "Built-in CSS easings are too weak — use strong custom curves.",
        current: timing,
        suggested: EASING_CURVES.easeOut,
      });
    }
  }

  // — Duration: UI animation over 300ms —
  if (dur !== null && dur > DURATION.uiMaxMs) {
    const modal = looksLikeModal(anim);
    // Modals/drawers get the 200–500ms band; everything else is capped at 300ms.
    if (!(modal && dur <= DURATION.modalMs[1])) {
      findings.push({
        ...base,
        category: "duration",
        severity: dur > 600 ? "warning" : "suggestion",
        title: `Duration ${dur}ms exceeds the UI budget`,
        detail: `${dur}ms is over the ${DURATION.uiMaxMs}ms ceiling for UI motion${modal ? " (even the modal/drawer band tops out at 500ms)" : ""}.`,
        why: "Longer animations make the interface feel sluggish; a 180ms transition feels snappier than a 400ms one.",
        fix: modal
          ? `Bring it into the 200–500ms modal/drawer band — try ${DURATION.modalMs[0]}–300ms.`
          : `Reduce to ≤ ${DURATION.uiMaxMs}ms (150–250ms is the sweet spot for most UI).`,
        standard: "UI animations stay under 300ms (modals/drawers: 200–500ms).",
        current: `${dur}ms`,
        suggested: modal ? "≤ 500ms" : "≤ 300ms",
      });
    }
  }

  // — Physicality: scale(0) entrance —
  if (hasScaleFromZero(anim)) {
    findings.push({
      ...base,
      category: "physicality",
      severity: "warning",
      title: "Entrance scales from 0",
      detail: "The element grows from `scale(0)` — nothing in the real world appears from nothing.",
      why: "Starting from zero looks unnatural and draws attention to the mechanic instead of the content.",
      fix: `Start from \`scale(${SCALE.recommendedEntranceScale})\` + \`opacity: 0\` instead.`,
      standard: `Never scale(0). Start from ${SCALE.minEntranceScale}–0.97.`,
      current: "scale(0)",
      suggested: `scale(${SCALE.recommendedEntranceScale})`,
    });
  }

  // — Performance: transition-property "all" —
  if (prop) {
    const props = prop.split(",").map((p) => p.trim().toLowerCase());
    if (props.includes("all")) {
      findings.push({
        ...base,
        category: "performance",
        severity: "suggestion",
        title: "transition: all",
        detail: "`transition-property: all` animates every property that changes, including layout properties off the GPU.",
        why: "Unintended properties animate on the main thread and can drop frames.",
        fix: "Name the exact properties — ideally only `transform` and `opacity`.",
        standard: "Animate transform & opacity only; `transition: all` is always a finding.",
        current: prop,
        suggested: "transform, opacity",
      });
    }
    const layoutHit = props.filter((p) => LAYOUT_PROPS.includes(p));
    if (layoutHit.length > 0) {
      findings.push({
        ...base,
        category: "performance",
        severity: "warning",
        title: `Animating layout propert${layoutHit.length === 1 ? "y" : "ies"}: ${layoutHit.join(", ")}`,
        detail: `Animating ${layoutHit.join(", ")} triggers layout + paint + composite on every frame.`,
        why: "Layout-driven animation runs off the GPU and stutters under load.",
        fix: "Re-express the motion with `transform` (translate/scale) and `opacity`.",
        standard: "Only animate transform and opacity — they skip layout/paint.",
        current: layoutHit.join(", "),
        suggested: "transform / opacity",
      });
    }
  }

  // — Purpose/frequency: infinite loop on a non-decorative element —
  const iter = iterationCount(anim);
  if (iter === "infinite") {
    const decorative = /(spinner|loader|loading|pulse|marquee|ticker|progress|skeleton|shimmer)/.test(
      `${anim.common_name} ${anim.selector} ${anim.technical_name}`.toLowerCase(),
    );
    if (!decorative) {
      findings.push({
        ...base,
        category: "performance",
        severity: "suggestion",
        title: "Infinite animation on a non-loader element",
        detail: "An `animation-iteration-count: infinite` loop that isn't a spinner/loader/marquee keeps the compositor awake.",
        why: "Constant motion is distracting on frequently-seen UI and wastes battery / GPU.",
        fix: "Reserve infinite loops for genuine loading indicators; otherwise play once.",
        standard: "Motion needs a purpose — 'it looks cool' on a constant element is not one.",
        current: "infinite",
        suggested: "1 (or a real loading state)",
      });
    }
  }

  return findings;
}

/** Cross-animation cohesion checks (duplicated near-identical curves/durations). */
function cohesionFindings(anims: DetectedAnimation[]): AnimationFinding[] {
  const findings: AnimationFinding[] = [];
  const curves = new Set<string>();
  for (const a of anims) {
    const t = timingFunction(a);
    if (t && t.startsWith("cubic-bezier")) curves.add(t.replace(/\s+/g, ""));
  }
  if (curves.size >= 4) {
    findings.push({
      anim_id: "*",
      selector: "(project-wide)",
      common_name: "Easing tokens",
      category: "cohesion",
      severity: "suggestion",
      title: `${curves.size} distinct hand-rolled easing curves`,
      detail: `The page uses ${curves.size} different cubic-bezier curves. A handful of almost-matching curves is a consolidation smell.`,
      why: "Inconsistent easing makes motion feel incoherent across components.",
      fix: `Consolidate onto shared tokens — e.g. \`--ease-out: ${EASING_CURVES.easeOut}\` and \`--ease-in-out: ${EASING_CURVES.easeInOut}\`.`,
      standard: "Curves and durations should live as shared tokens.",
      current: `${curves.size} curves`,
      suggested: "2–3 shared tokens",
    });
  }
  return findings;
}

/**
 * Stagger choreography check: grouped entrances whose delay intervals fall
 * outside Emil's 30-80ms band. Groups are animations sharing a source and
 * signature (keyframes name, or transition property + duration) with distinct
 * delays — the shape a staggered list renders as.
 */
function staggerFindings(anims: DetectedAnimation[]): AnimationFinding[] {
  const findings: AnimationFinding[] = [];
  const groups = new Map<string, DetectedAnimation[]>();
  for (const a of anims) {
    if (delayMs(a) === null) continue;
    const signature = keyframesName(a) ?? `${transitionProperty(a) ?? "?"}|${durationMs(a) ?? "?"}`;
    // The normalized selector keeps the group honest: only structural siblings
    // (same path modulo :nth-of-type) count as one staggered list — a toast, a
    // modal and a badge reusing the same `fadeIn` keyframes never group.
    const key = `${a.source}|${signature}|${normalizedSelector(a)}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  for (const members of groups.values()) {
    if (members.length < 3) continue;
    const delays = [...new Set(members.map((m) => delayMs(m) as number))].sort((x, y) => x - y);
    if (delays.length < 2) continue;
    const intervals = delays.slice(1).map((d, i) => d - delays[i]);
    const median = medianOf(intervals);
    if (median >= STAGGER.minMs && median <= STAGGER.maxMs) continue;

    const first = members[0];
    const tooTight = median < STAGGER.minMs;
    findings.push({
      anim_id: first.id,
      selector: `${members.length} elements`,
      common_name: first.common_name,
      category: "cohesion",
      severity: "suggestion",
      title: tooTight ? "Stagger interval too tight" : "Stagger interval too slow",
      detail: `${members.length} grouped entrances stagger at ~${median}ms intervals${tooTight ? " — they read as one simultaneous blob" : " — the tail of the group feels like it lags"}.`,
      why: tooTight
        ? "Below ~30ms the eye can't separate the items, so the stagger adds delay without adding rhythm."
        : "Above ~80ms the later items feel disconnected from the first, and the page feels slower than it is.",
      fix: `Space the delays ${STAGGER.minMs}-${STAGGER.maxMs}ms apart.`,
      standard: `Stagger grouped entrances ${STAGGER.minMs}-${STAGGER.maxMs}ms apart.`,
      current: `~${median}ms interval`,
      suggested: `${STAGGER.minMs}-${STAGGER.maxMs}ms`,
    });
  }
  return findings;
}

/** Split an animation name into lowercase tokens across camelCase/kebab/snake boundaries. */
function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

const EXIT_TOKENS = new Set(["out", "exit", "leave", "close", "hide", "dismiss"]);
const ENTER_TOKENS = new Set(["in", "enter", "open", "show", "appear", "reveal", "entrance"]);

/**
 * Exit-speed check: exits should run ~20% faster than their entrance. Pairs are
 * matched conservatively by keyframes name — `fadeIn`/`fadeOut`, `slide-in`/
 * `slide-out` — so a lone name never produces a finding.
 */
function exitSpeedFindings(anims: DetectedAnimation[]): AnimationFinding[] {
  const findings: AnimationFinding[] = [];
  const pairs = new Map<string, { enter?: { anim: DetectedAnimation; name: string; dur: number }; exit?: { anim: DetectedAnimation; name: string; dur: number } }>();

  for (const a of anims) {
    const name = keyframesName(a);
    const dur = durationMs(a);
    if (!name || dur === null) continue;
    const tokens = nameTokens(name);
    const role = tokens.some((t) => EXIT_TOKENS.has(t)) ? "exit" : tokens.some((t) => ENTER_TOKENS.has(t)) ? "enter" : null;
    if (!role) continue;
    const base = tokens.filter((t) => !EXIT_TOKENS.has(t) && !ENTER_TOKENS.has(t)).join("-");
    if (!base) continue;
    // Pair only within one element (same normalized selector) so two unrelated
    // components sharing generic fadeIn/fadeOut names never get cross-paired.
    const key = `${base}|${normalizedSelector(a)}`;
    const entry = pairs.get(key) ?? {};
    entry[role] ??= { anim: a, name, dur };
    pairs.set(key, entry);
  }

  for (const { enter, exit } of pairs.values()) {
    if (!enter || !exit) continue;
    const target = Math.round(enter.dur * (1 - DURATION.exitSpeedup));
    if (exit.dur <= target) continue;
    findings.push({
      anim_id: exit.anim.id,
      selector: exit.anim.selector,
      common_name: exit.anim.common_name,
      category: "duration",
      severity: "suggestion",
      title: "Exit isn't faster than its entrance",
      detail: `\`${exit.name}\` runs ${exit.dur}ms while its entrance \`${enter.name}\` runs ${enter.dur}ms.`,
      why: "Leaving is a decided action — a slow exit makes dismissal feel like it's resisting the user.",
      fix: `Run exits ~${Math.round(DURATION.exitSpeedup * 100)}% faster than their entrance — try ≤ ${target}ms.`,
      standard: `Exits run ~${Math.round(DURATION.exitSpeedup * 100)}% faster than the matching entrance.`,
      current: `${exit.dur}ms`,
      suggested: `≤ ${target}ms`,
    });
  }
  return findings;
}

/**
 * Page-level accessibility checks (Emil Standard 8). These read the captured
 * stylesheet text, so they only fire when we actually harvested CSS — with no
 * stylesheet in hand we have no evidence a rule is *absent*, and stay silent
 * rather than raise a false positive.
 */
function accessibilityFindings(capture: TunerCapture): AnimationFinding[] {
  const findings: AnimationFinding[] = [];
  const css = capture.animations.find((a) => a.preview_css && a.preview_css.trim())?.preview_css ?? "";
  if (!css) return findings;

  // — Reduced motion: movement-based animation with no reduced-motion escape hatch —
  const hasMovement = capture.animations.some((a) => {
    if (a.source === "css-keyframes") return true;
    const prop = (transitionProperty(a) ?? "").toLowerCase();
    return /\b(transform|all)\b/.test(prop);
  });
  if (hasMovement && !/prefers-reduced-motion/i.test(css)) {
    findings.push({
      anim_id: "*",
      selector: "(project-wide)",
      common_name: "Page stylesheet",
      category: "accessibility",
      severity: "warning",
      title: "No prefers-reduced-motion path",
      detail: "The page animates movement (transform / keyframes) but ships no `@media (prefers-reduced-motion: reduce)` rule.",
      why: "Motion-sensitive users get no relief; large movement can trigger nausea or vestibular symptoms.",
      fix: "Add `@media (prefers-reduced-motion: reduce)` that drops transform-based motion while keeping opacity/colour transitions.",
      standard: "Honour prefers-reduced-motion — gentler, not zero.",
      current: "(no reduced-motion rule)",
      suggested: "@media (prefers-reduced-motion: reduce) { … }",
    });
  }

  // — Hover gating: hover motion that isn't behind (hover: hover) fires on touch taps —
  const hasHover = capture.animations.some(looksLikeHover);
  if (hasHover && !/@media[^{]*hover\s*:\s*hover/i.test(css)) {
    findings.push({
      anim_id: "*",
      selector: "(project-wide)",
      common_name: "Hover motion",
      category: "accessibility",
      severity: "suggestion",
      title: "Hover motion isn't gated for touch",
      detail: "Hover-triggered motion isn't wrapped in `@media (hover: hover) and (pointer: fine)`.",
      why: "Touch devices fire a synthetic hover on tap, so the animation plays on every touch — a false positive the user never intended.",
      fix: "Gate hover animations behind `@media (hover: hover) and (pointer: fine)`.",
      standard: "Gate hover motion behind (hover: hover) and (pointer: fine).",
      current: "(ungated :hover)",
      suggested: "@media (hover: hover) and (pointer: fine) { … }",
    });
  }

  return findings;
}

/** Lint an entire tuner capture and produce a scored audit. */
export function auditAnimations(capture: TunerCapture): AnimationAudit {
  const perAnim = capture.animations.flatMap(lintAnimation);
  const findings = [
    ...perAnim,
    ...cohesionFindings(capture.animations),
    ...staggerFindings(capture.animations),
    ...exitSpeedFindings(capture.animations),
    ...accessibilityFindings(capture),
  ].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const critical_count = findings.filter((f) => f.severity === "critical").length;
  const warning_count = findings.filter((f) => f.severity === "warning").length;
  const suggestion_count = findings.filter((f) => f.severity === "suggestion").length;

  // Score: start at 100, subtract weighted penalties, floor at 0.
  const penalty = critical_count * 25 + warning_count * 10 + suggestion_count * 3;
  const score = Math.max(0, 100 - penalty);

  return {
    url: capture.url,
    captured_at: capture.captured_at,
    viewport: capture.viewport,
    total_animations: capture.animations.length,
    findings,
    critical_count,
    warning_count,
    suggestion_count,
    score,
  };
}
