import type { Page } from "playwright";

/** A notable on-page element the model can cite by ref ("E3") in findings. */
export interface DomElementRef {
  ref: string;
  selector: string;
  label: string;
  /** Document coordinates in CSS px (measured at scroll origin). */
  rect: Rect;
}

export interface DomSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  /** Full document dimensions in CSS px — the coordinate space of `elements` rects and full-page screenshots. */
  page: { width: number; height: number };
  /** Notable elements with stable refs, for grounded findings and annotated screenshots. */
  elements: DomElementRef[];
  text_outline: string[];
  forms: Array<{ inputs: number; buttons: number; labels: number; inputs_without_labels: number }>;
  ctas: Array<{ text: string; tag: string; rect: Rect; effective_size: number }>;
  small_tap_targets: Array<{ tag: string; text: string; rect: Rect; reason: string }>;
  smallest_text: { px: number; sample: string } | null;
  body_font_px: number | null;
  horizontal_overflow: boolean;
  overflow_amount_px: number;
  type_size_count: number;
  computed_color_pairs_under_threshold: Array<{ text: string; ratio_estimate: number }>;
  loading_indicators: { spinners: number; skeletons: number; progressbars: number };
  empty_lists: Array<{ selector: string; rect: Rect }>;
  /** "Things missing" we couldn't infer — for the model to look at the screenshot for. */
  qualitative_only: string[];
}

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Pulls a structured snapshot of the rendered DOM that the vision model
 * receives alongside the screenshot. Provides authoritative measurements
 * so the model doesn't have to OCR pixel sizes — just cross-check its
 * visual judgment against the numbers.
 */
export async function captureDomSnapshot(page: Page): Promise<DomSnapshot> {
  // Wrapped with a `__name` shim: esbuild-based loaders (tsx) transform this
  // module with keepNames, sprinkling `__name(...)` helper calls through the
  // serialized function body — a helper that doesn't exist in the browser.
  // Building the wrapper via `new Function` keeps the shim (the wrapper source
  // is never transformed) while letting Playwright pass it through
  // Runtime.callFunctionOn — unlike a string, which Runtime.evaluate would
  // refuse on pages with a CSP lacking 'unsafe-eval'.
  const src = snapshotPage.toString();
  const wrapped = new Function(`var __name = (f) => f; return (${src})();`) as () => DomSnapshot;
  return await page.evaluate(wrapped);
}

function snapshotPage(): DomSnapshot {
  {
    const doc = document;
    const win = window;

    const rect = (el: Element): { x: number; y: number; w: number; h: number } => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };

    const isVisible = (el: Element): boolean => {
      const cs = win.getComputedStyle(el as HTMLElement);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const text = (el: Element): string => ((el as HTMLElement).innerText || el.textContent || "").trim();

    // Text outline — every visible heading/paragraph/button/link in DOM order.
    const text_outline: string[] = [];
    doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,label,button,a,strong,em,th,td").forEach((el) => {
      if (!isVisible(el)) return;
      const t = text(el);
      if (!t) return;
      const tag = el.tagName.toLowerCase();
      const trimmed = t.length > 140 ? t.slice(0, 140) + "…" : t;
      text_outline.push(`[${tag}] ${trimmed}`);
    });

    // Forms.
    const forms: Array<{ inputs: number; buttons: number; labels: number; inputs_without_labels: number }> = [];
    doc.querySelectorAll("form").forEach((form) => {
      const inputs = form.querySelectorAll("input,select,textarea");
      const buttons = form.querySelectorAll("button,input[type=submit],input[type=button]");
      const labels = form.querySelectorAll("label");
      let inputs_without_labels = 0;
      inputs.forEach((inp) => {
        const id = (inp as HTMLInputElement).id;
        const associatedLabel = id ? form.querySelector(`label[for="${id}"]`) : null;
        const wrappingLabel = (inp as HTMLElement).closest("label");
        const ariaLabel = (inp as HTMLElement).getAttribute("aria-label");
        if (!associatedLabel && !wrappingLabel && !ariaLabel) inputs_without_labels++;
      });
      forms.push({
        inputs: inputs.length,
        buttons: buttons.length,
        labels: labels.length,
        inputs_without_labels,
      });
    });

    // CTAs — buttons + button-styled links.
    const ctas: Array<{ text: string; tag: string; rect: { x: number; y: number; w: number; h: number }; effective_size: number }> = [];
    doc.querySelectorAll("button, a.btn, a[role=button], input[type=submit], input[type=button]").forEach((el) => {
      if (!isVisible(el)) return;
      const r = rect(el);
      ctas.push({
        text: text(el).slice(0, 80),
        tag: el.tagName.toLowerCase(),
        rect: r,
        effective_size: Math.min(r.w, r.h),
      });
    });

    // Small tap targets — anything interactive < 44×44 (Apple HIG floor).
    const small_tap_targets: Array<{ tag: string; text: string; rect: { x: number; y: number; w: number; h: number }; reason: string }> = [];
    doc.querySelectorAll("button, a, input[type=submit], input[type=button], [role=button], [role=link]").forEach((el) => {
      if (!isVisible(el)) return;
      const r = rect(el);
      if (r.w < 44 || r.h < 44) {
        small_tap_targets.push({
          tag: el.tagName.toLowerCase(),
          text: text(el).slice(0, 40),
          rect: r,
          reason: `${r.w}x${r.h}px is below the 44×44 HIG / 48×48 Material floor.`,
        });
      }
    });

    // Body font size + smallest visible text.
    const bodyCs = win.getComputedStyle(doc.body);
    const body_font_px = parseFloat(bodyCs.fontSize) || null;

    let smallest_text: { px: number; sample: string } | null = null;
    const sizeSet = new Set<number>();
    doc.querySelectorAll("p, span, li, a, label, td, th, button, input, small, em, strong, h1, h2, h3, h4, h5, h6, div").forEach((el) => {
      if (!isVisible(el)) return;
      const t = text(el);
      if (!t || t.length < 3) return;
      const cs = win.getComputedStyle(el as HTMLElement);
      const px = parseFloat(cs.fontSize);
      if (!Number.isFinite(px)) return;
      sizeSet.add(Math.round(px));
      if (smallest_text == null || px < smallest_text.px) {
        smallest_text = { px: Math.round(px * 10) / 10, sample: t.slice(0, 60) };
      }
    });
    const type_size_count = sizeSet.size;

    // Horizontal overflow.
    const docWidth = doc.documentElement.scrollWidth;
    const winWidth = win.innerWidth;
    const horizontal_overflow = docWidth > winWidth + 1;
    const overflow_amount_px = horizontal_overflow ? docWidth - winWidth : 0;

    // Loading indicators (heuristic).
    const spinners = doc.querySelectorAll("[role=progressbar], [class*=spinner], [class*=loader], svg[class*=spin]").length;
    const skeletons = doc.querySelectorAll("[class*=skeleton], [class*=shimmer], [class*=placeholder]").length;
    const progressbars = doc.querySelectorAll("progress, [role=progressbar]").length;

    // Notable elements with stable refs — interactive controls and headings the
    // model can cite (element_ref) so findings map back to exact pixel rects.
    const docRect = (el: Element): { x: number; y: number; w: number; h: number } => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return {
        x: Math.round(r.x + win.scrollX),
        y: Math.round(r.y + win.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const shortSelector = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = (el as HTMLElement).id;
      if (id) return `${tag}#${id}`;
      const cls = String((el as HTMLElement).className || "").trim().split(/\s+/).filter(Boolean)[0];
      return cls ? `${tag}.${cls}` : tag;
    };
    const elements: Array<{ ref: string; selector: string; label: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    const seenRects = new Set<string>();
    doc.querySelectorAll("h1, h2, h3, button, a, input, select, textarea, [role=button], img").forEach((el) => {
      if (elements.length >= 30) return;
      if (!isVisible(el)) return;
      const r = docRect(el);
      if (r.w < 8 || r.h < 8) return;
      const key = `${r.x},${r.y},${r.w},${r.h}`;
      if (seenRects.has(key)) return;
      seenRects.add(key);
      const label =
        text(el).slice(0, 60) ||
        (el as HTMLElement).getAttribute("aria-label") ||
        (el as HTMLImageElement).alt ||
        el.tagName.toLowerCase();
      elements.push({ ref: `E${elements.length + 1}`, selector: shortSelector(el), label, rect: r });
    });

    // Empty interactive lists.
    const empty_lists: Array<{ selector: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    doc.querySelectorAll("ul, ol, [role=list], [data-list]").forEach((el) => {
      if (!isVisible(el)) return;
      if (el.children.length === 0 && text(el).length === 0) {
        const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
        const cls = (el as HTMLElement).className ? `.${String((el as HTMLElement).className).trim().split(/\s+/).join(".")}` : "";
        empty_lists.push({ selector: `${el.tagName.toLowerCase()}${id}${cls}`, rect: rect(el) });
      }
    });

    // Lightweight contrast estimate — picks a few text elements with computed color/background.
    function parseColor(c: string): [number, number, number] | null {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    }
    function rel(c: number): number {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    function lum(rgb: [number, number, number]): number {
      return 0.2126 * rel(rgb[0]) + 0.7152 * rel(rgb[1]) + 0.0722 * rel(rgb[2]);
    }
    function contrast(a: [number, number, number], b: [number, number, number]): number {
      const la = lum(a), lb = lum(b);
      const [hi, lo] = la > lb ? [la, lb] : [lb, la];
      return (hi + 0.05) / (lo + 0.05);
    }
    const computed_color_pairs_under_threshold: Array<{ text: string; ratio_estimate: number }> = [];
    doc.querySelectorAll("p, button, a, h1, h2, h3, span, label, li").forEach((el) => {
      if (!isVisible(el)) return;
      const t = text(el);
      if (!t || t.length < 3) return;
      const cs = win.getComputedStyle(el as HTMLElement);
      const fg = parseColor(cs.color);
      // Walk up to find first non-transparent background.
      let bgEl: HTMLElement | null = el as HTMLElement;
      let bg: [number, number, number] | null = null;
      while (bgEl) {
        const bgcs = win.getComputedStyle(bgEl);
        const cand = parseColor(bgcs.backgroundColor);
        if (cand && bgcs.backgroundColor !== "rgba(0, 0, 0, 0)") { bg = cand; break; }
        bgEl = bgEl.parentElement;
      }
      if (!fg || !bg) return;
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) {
        computed_color_pairs_under_threshold.push({ text: t.slice(0, 60), ratio_estimate: Math.round(ratio * 100) / 100 });
      }
    });

    return {
      url: location.href,
      title: doc.title,
      viewport: { width: win.innerWidth, height: win.innerHeight },
      page: { width: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight },
      elements,
      text_outline: text_outline.slice(0, 80),
      forms,
      ctas: ctas.slice(0, 20),
      small_tap_targets: small_tap_targets.slice(0, 20),
      smallest_text,
      body_font_px,
      horizontal_overflow,
      overflow_amount_px,
      type_size_count,
      computed_color_pairs_under_threshold: computed_color_pairs_under_threshold.slice(0, 20),
      loading_indicators: { spinners, skeletons, progressbars },
      empty_lists,
      qualitative_only: [
        "Visual hierarchy / which element draws the eye first.",
        "Brand cohesion / palette feeling.",
        "Whether copy reads naturally.",
        "Information density / overall 'busyness'.",
      ],
    };
  }
}
