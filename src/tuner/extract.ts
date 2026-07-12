import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { INSTRUMENTATION_SOURCE } from "./instrument.js";
import { EMIL_EASING_PRESETS } from "./standards.js";
import type { AnimationParam, AnimationPreset, AnimationSource, DetectedAnimation, TunerCapture } from "./types.js";

// The tuner offers Emil Kowalski's strong curves first (the linter recommends these
// verbatim), then the softer/decorative options. Single source of truth in standards.ts.
const EASING_PRESETS: AnimationPreset[] = EMIL_EASING_PRESETS.map(({ name, value, description }) => ({ name, value, description }));

interface RawAnim {
  source: AnimationSource;
  selector: string | null;
  common_name?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  params?: Record<string, unknown>;
  recorded_at?: number;
  index?: number;
  id?: string;
}

function parseDurationMs(s: unknown): number {
  if (typeof s !== "string") return 0;
  const trimmed = s.trim();
  if (trimmed.endsWith("ms")) return Number(trimmed.slice(0, -2)) || 0;
  if (trimmed.endsWith("s")) return (Number(trimmed.slice(0, -1)) || 0) * 1000;
  return Number(trimmed) || 0;
}

function deriveTechnicalName(raw: RawAnim): string {
  switch (raw.source) {
    case "css-transition": {
      const p = raw.params ?? {};
      return `CSS transition · ${String(p.property ?? "all")} · ${String(p.duration ?? "—")} · ${String(p.timing ?? "linear")}`;
    }
    case "css-keyframes": {
      const p = raw.params ?? {};
      return `CSS @keyframes "${String(p.name ?? "?")}" · ${String(p.duration ?? "—")} · ${String(p.timing ?? "linear")}`;
    }
    case "gsap": {
      const p = raw.params ?? {};
      const method = String(p.method ?? "to");
      return `GSAP ${method}() tween`;
    }
    case "animejs":
      return `anime.js ${raw.params?.easing ? "tween (easing=" + String(raw.params.easing) + ")" : "tween"}`;
    case "motion-one":
      return `Motion One animate()`;
    case "auto-animate":
      return `auto-animate list transition`;
    case "lottie":
      return `Lottie JSON animation`;
    case "web-animations-api":
      return `Element.animate() (WAAPI)`;
  }
}

function deriveParams(raw: RawAnim): AnimationParam[] {
  const params: AnimationParam[] = [];
  const p = (raw.params ?? {}) as Record<string, unknown>;

  switch (raw.source) {
    case "css-transition":
    case "css-keyframes": {
      const dur = parseDurationMs(p.duration);
      const delay = parseDurationMs(p.delay);
      params.push({ name: "duration", label: "Duration", technical: "transition-duration / animation-duration", min: 50, max: 2000, step: 50, value: Math.max(50, Math.round(dur || 300)), unit: "ms" });
      params.push({ name: "delay", label: "Delay", technical: "transition-delay / animation-delay", min: 0, max: 1500, step: 50, value: Math.max(0, Math.round(delay)), unit: "ms" });
      break;
    }
    case "gsap": {
      const vars = (p.vars ?? {}) as Record<string, unknown>;
      const dur = typeof vars.duration === "number" ? vars.duration * 1000 : 600;
      const delay = typeof vars.delay === "number" ? vars.delay * 1000 : 0;
      params.push({ name: "duration", label: "Duration", technical: "gsap.to({ duration })", min: 50, max: 3000, step: 50, value: Math.round(dur), unit: "ms" });
      params.push({ name: "delay", label: "Delay", technical: "gsap.to({ delay })", min: 0, max: 2000, step: 50, value: Math.round(delay), unit: "ms" });
      if (typeof vars.stagger === "number") {
        params.push({ name: "stagger", label: "Stagger interval", technical: "gsap.to({ stagger })", min: 0, max: 500, step: 10, value: Math.round(vars.stagger * 1000), unit: "ms" });
      }
      break;
    }
    case "animejs": {
      const dur = typeof p.duration === "number" ? p.duration : 600;
      const delay = typeof p.delay === "number" ? p.delay : 0;
      params.push({ name: "duration", label: "Duration", technical: "anime({ duration })", min: 50, max: 3000, step: 50, value: Math.round(dur), unit: "ms" });
      params.push({ name: "delay", label: "Delay", technical: "anime({ delay })", min: 0, max: 2000, step: 50, value: Math.round(delay), unit: "ms" });
      break;
    }
    case "motion-one": {
      const opts = (p.options ?? {}) as Record<string, unknown>;
      const dur = typeof opts.duration === "number" ? opts.duration * 1000 : 600;
      const delay = typeof opts.delay === "number" ? opts.delay * 1000 : 0;
      params.push({ name: "duration", label: "Duration", technical: "animate(el, kf, { duration })", min: 50, max: 3000, step: 50, value: Math.round(dur), unit: "ms" });
      params.push({ name: "delay", label: "Delay", technical: "animate(el, kf, { delay })", min: 0, max: 2000, step: 50, value: Math.round(delay), unit: "ms" });
      break;
    }
    case "auto-animate":
      params.push({ name: "duration", label: "Duration", technical: "autoAnimate(parent, { duration })", min: 100, max: 2000, step: 50, value: 250, unit: "ms" });
      break;
    case "lottie":
      params.push({ name: "speed", label: "Speed multiplier", technical: "lottie.setSpeed()", min: 25, max: 400, step: 25, value: 100, unit: "%" });
      break;
    case "web-animations-api":
      params.push({ name: "duration", label: "Duration", technical: "Element.animate({ duration })", min: 50, max: 3000, step: 50, value: 600, unit: "ms" });
      break;
  }

  return params;
}

function detectedFromRaw(raw: RawAnim): DetectedAnimation {
  return {
    id: raw.id ?? createHash("sha1").update(JSON.stringify(raw)).digest("hex").slice(0, 10),
    selector: raw.selector ?? "(unknown)",
    source: raw.source,
    technical_name: deriveTechnicalName(raw),
    common_name: raw.common_name ?? "(unknown element)",
    bbox: raw.bbox ?? { x: 0, y: 0, w: 0, h: 0 },
    preview_html: "",
    preview_css: "",
    params: deriveParams(raw),
    presets: EASING_PRESETS,
    raw: raw as unknown as Record<string, unknown>,
  };
}

export interface ExtractOptions {
  url: string;
  viewport?: { width: number; height: number };
  /** Time to wait after load before harvesting (ms). */
  settleMs?: number;
}

/**
 * Open the URL in a Playwright browser instrumented with the hook script,
 * wait for animations to settle, and read back the recorded entries. Then
 * fetch each animated element's outerHTML + nearest stylesheet text so the
 * tuner can re-render a faithful live preview without loading the source page.
 */
export async function extractAnimations(opts: ExtractOptions): Promise<TunerCapture> {
  const viewport = opts.viewport ?? { width: 1280, height: 800 };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  await context.addInitScript({ content: INSTRUMENTATION_SOURCE });
  const page = await context.newPage();
  try {
    await page.goto(opts.url, { waitUntil: "networkidle", timeout: 15_000 });
    await page.waitForTimeout(opts.settleMs ?? 1500);

    const raw: RawAnim[] = await page.evaluate(() => (window as unknown as { __mlAnimations: RawAnim[] }).__mlAnimations ?? []);
    // Dedupe in two passes:
    // (1) by exact (source, selector, params) — kills literal repeats
    // (2) by (source, common_name root, params) — collapses N nav links sharing one transition into one entry
    const exactDedup = new Map<string, RawAnim>();
    for (const r of raw) {
      const key = `${r.source}|${r.selector}|${JSON.stringify(r.params ?? {}).slice(0, 200)}`;
      if (!exactDedup.has(key)) exactDedup.set(key, r);
    }
    const semanticDedup = new Map<string, RawAnim>();
    for (const r of exactDedup.values()) {
      const root = (r.common_name ?? "").split("/")[0].trim();
      const tag = (r.selector ?? "").split(">").pop()?.split(".")[0]?.trim() ?? "";
      const semKey = `${r.source}|${root}|${tag}|${JSON.stringify(r.params ?? {}).slice(0, 200)}`;
      if (!semanticDedup.has(semKey)) semanticDedup.set(semKey, r);
    }
    const unique = [...semanticDedup.values()].slice(0, 40);

    // For each detected animation, capture the element's outerHTML + the page's stylesheet text.
    const styleText: string = await page.evaluate(() => {
      const parts: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            parts.push(rule.cssText);
          }
        } catch {
          /* cross-origin sheet — skip */
        }
      }
      return parts.join("\n");
    });

    // Capture <body> computed styles so each shadow-DOM preview can reflect the page's theme.
    const pageStyles = await page.evaluate(() => {
      const cs = window.getComputedStyle(document.body);
      return {
        backgroundColor: cs.backgroundColor || "transparent",
        backgroundImage: cs.backgroundImage || "none",
        color: cs.color || "inherit",
        fontFamily: cs.fontFamily || "ui-sans-serif, system-ui, -apple-system, sans-serif",
      };
    });

    const detected: DetectedAnimation[] = [];
    for (const r of unique) {
      const det = detectedFromRaw(r);
      if (det.selector && det.selector !== "(unknown)") {
        try {
          const html = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? (el as HTMLElement).outerHTML : "";
          }, det.selector);
          det.preview_html = (html ?? "").slice(0, 2000);
        } catch {
          /* ignore */
        }
      }
      det.preview_css = styleText.length > 100_000 ? styleText.slice(0, 100_000) : styleText;
      detected.push(det);
    }

    const capture_id = createHash("sha1").update(opts.url + "|" + detected.map((d) => d.selector).join(",")).digest("hex").slice(0, 12);

    return {
      url: opts.url,
      captured_at: new Date().toISOString(),
      viewport,
      animations: detected,
      capture_id,
      page_styles: pageStyles,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
