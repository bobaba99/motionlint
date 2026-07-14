/**
 * Interaction-state grids: capture each interactive element in its default /
 * hover / focus / active states and compose one labeled grid image. The model
 * receives a single artifact where affordance problems — invisible focus
 * rings, missing hover feedback, no pressed state — are directly comparable
 * across columns.
 */
import sharp from "sharp";
import type { Locator } from "playwright";
import type { AuthConfig, Viewport } from "../types.js";
import { applyPageAuth, launchBrowserSession } from "./browser.js";

export const GRID_STATES = ["default", "hover", "focus", "active"] as const;
export type GridState = (typeof GRID_STATES)[number];

export interface StateGridOptions {
  url: string;
  viewport: Viewport;
  waitFor?: string;
  waitTimeout?: number;
  auth?: AuthConfig;
  /** Max interactive elements sampled (rows). */
  maxElements?: number;
}

export interface StateGridResult {
  /** Composed PNG. */
  buffer: Buffer;
  width: number;
  height: number;
  /** Row labels in order. */
  elements: string[];
  states: readonly GridState[];
}

const CELL_W = 260;
const CELL_H = 84;
const GAP = 12;
const HEADER_H = 28;
const ROW_LABEL_H = 24;
const PAD = 14;
const BG = "#0b0d12";

function svgBar(width: number, height: number, text: string, size = 13): Buffer {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <text x="8" y="${height - 8}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
            font-size="${size}" fill="#e7eaf0">${safe}</text>
    </svg>`,
  );
}

async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

type Clip = { x: number; y: number; width: number; height: number };

function unionClip(a: Clip, b: Clip | null, viewport: Viewport): Clip {
  const x1 = Math.max(0, Math.min(a.x, b?.x ?? a.x));
  const y1 = Math.max(0, Math.min(a.y, b?.y ?? a.y));
  const x2 = Math.min(viewport.width, Math.max(a.x + a.width, b ? b.x + b.width : 0));
  const y2 = Math.min(viewport.height, Math.max(a.y + a.height, b ? b.y + b.height : 0));
  return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
}

/** Capture one element's clip in a given interaction state. */
async function captureState(locator: Locator, state: GridState, baseClip: Clip, viewport: Viewport): Promise<Buffer> {
  const page = locator.page();
  switch (state) {
    case "default":
      break;
    case "hover":
      await locator.hover({ timeout: 2000 });
      break;
    case "focus":
      await locator.focus({ timeout: 2000 });
      break;
    case "active": {
      await locator.hover({ timeout: 2000 });
      await page.mouse.down();
      break;
    }
  }
  await settle(320); // let ≤300ms transitions finish
  try {
    // Elements can move/grow on hover/focus (scale, lift, focus ring outside
    // the box) — re-measure and widen the clip so the feedback stays in frame.
    const now = await locator.boundingBox().catch(() => null);
    const padded = now
      ? { x: now.x - PAD, y: now.y - PAD, width: now.width + PAD * 2, height: now.height + PAD * 2 }
      : null;
    const clip = unionClip(baseClip, padded, viewport);
    return await page.screenshot({ clip });
  } finally {
    if (state === "active") {
      // Release AWAY from the element: mouseup at the original position would
      // complete a real click — navigating links, submitting forms.
      await page.mouse.move(1, 1);
      await page.mouse.up();
    } else {
      await page.mouse.move(1, 1);
    }
    await locator.evaluate((el) => (el as HTMLElement).blur?.()).catch(() => {});
    await settle(320);
  }
}

/**
 * Capture the grid. Returns null when the page exposes no usable interactive
 * elements — callers treat the grid as an enhancement, not a requirement.
 */
export async function captureStateGrid(opts: StateGridOptions): Promise<StateGridResult | null> {
  const maxElements = opts.maxElements ?? 6;
  const session = await launchBrowserSession({ viewport: opts.viewport, auth: opts.auth });
  const page = await session.context.newPage();

  try {
    await applyPageAuth(page, opts.url, opts.auth);
    await page.goto(opts.url, {
      waitUntil: opts.waitFor === "networkidle" ? "networkidle" : "load",
      timeout: opts.waitTimeout ?? 15_000,
    });
    const startUrl = page.url();

    const candidates = await page
      .locator("button, a[role=button], a.btn, input[type=submit], [role=button], a")
      .all();

    const rows: Array<{ label: string; cells: Buffer[] }> = [];
    const seenLabels = new Set<string>();

    for (const locator of candidates) {
      if (rows.length >= maxElements) break;
      // If anything navigated the page, every remaining locator resolves
      // against the wrong document — stop with what we have.
      if (page.url() !== startUrl) break;
      const box = await locator.boundingBox().catch(() => null);
      if (!box || box.width < 24 || box.height < 14) continue;
      // Only elements fully inside the viewport — clips can't leave it.
      if (box.x < PAD || box.y < PAD) continue;
      if (box.x + box.width > opts.viewport.width - PAD) continue;
      if (box.y + box.height > opts.viewport.height - PAD) continue;

      // Same design, same states: dedupe repeated labels. Unlabeled (icon-only)
      // controls are distinct designs — key those by position instead.
      const text = ((await locator.innerText().catch(() => "")) || "").trim().slice(0, 40);
      const label = text || "(unlabeled)";
      const dedupeKey = text || `(unlabeled)@${Math.round(box.x)},${Math.round(box.y)}`;
      if (seenLabels.has(dedupeKey)) continue;
      seenLabels.add(dedupeKey);

      const clip = {
        x: box.x - PAD,
        y: box.y - PAD,
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
      };

      const cells: Buffer[] = [];
      let failed = false;
      for (const state of GRID_STATES) {
        try {
          cells.push(await captureState(locator, state, clip, opts.viewport));
        } catch {
          failed = true;
          break;
        }
      }
      if (!failed && page.url() === startUrl) rows.push({ label, cells });
    }

    if (rows.length === 0) return null;

    // Compose: uniform cells so state columns align across rows.
    const width = GAP + GRID_STATES.length * (CELL_W + GAP);
    let height = HEADER_H + GAP;
    const composites: sharp.OverlayOptions[] = [];

    GRID_STATES.forEach((state, col) => {
      composites.push({ input: svgBar(CELL_W, HEADER_H, state.toUpperCase(), 14), top: 0, left: GAP + col * (CELL_W + GAP) });
    });

    for (const row of rows) {
      composites.push({ input: svgBar(width - GAP * 2, ROW_LABEL_H, row.label), top: height, left: GAP });
      height += ROW_LABEL_H;
      for (let col = 0; col < row.cells.length; col++) {
        const cell = await sharp(row.cells[col])
          .resize({ width: CELL_W, height: CELL_H, fit: "contain", background: BG })
          .png()
          .toBuffer();
        composites.push({ input: cell, top: height, left: GAP + col * (CELL_W + GAP) });
      }
      height += CELL_H + GAP;
    }

    const buffer = await sharp({
      create: { width, height, channels: 3, background: BG },
    })
      .composite(composites)
      .png()
      .toBuffer();

    return { buffer, width, height, elements: rows.map((r) => r.label), states: GRID_STATES };
  } finally {
    await page.close().catch(() => {});
    await session.close();
  }
}
