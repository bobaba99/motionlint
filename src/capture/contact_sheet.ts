import sharp from "sharp";
import type { CapturedFrame } from "../flow/types.js";

const LABEL_BAR_HEIGHT = 26;
const COL_GAP = 4;
const ROW_GAP = 14;
const SUB_ROW_GAP = 4;
const LABEL_FONT_SIZE = 12;

export interface ContactSheetOptions {
  /** Max width per frame (px). Default 380 so 4 tiles fit per sub-row at the
      Anthropic-optimal 1568px sheet width. */
  frameWidth?: number;
  /** Max sheet width (px). Default 1568 — Anthropic's recommended-max long edge so
      tiles aren't downscaled before the model sees them. */
  maxSheetWidth?: number;
  /** Background color (hex without #). Default 0b0d12. */
  bg?: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgRowLabel(width: number, text: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_BAR_HEIGHT}">
      <rect x="0" y="0" width="${width}" height="${LABEL_BAR_HEIGHT}" fill="#0b0d12"/>
      <rect x="0" y="${LABEL_BAR_HEIGHT - 1}" width="${width}" height="1" fill="#2a2f3d"/>
      <text x="10" y="${LABEL_BAR_HEIGHT - 9}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
            font-size="${LABEL_FONT_SIZE}" fill="#e7eaf0">${escapeXml(text)}</text>
    </svg>`,
  );
}

function svgFrameTag(width: number, height: number, t: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="4" y="4" width="${Math.min(80, width - 8)}" height="18" rx="4" fill="rgba(0,0,0,0.55)"/>
      <text x="9" y="17" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
            font-size="11" fill="#e7eaf0">${escapeXml(t)}</text>
    </svg>`,
  );
}

interface Tile { png: Buffer; width: number; height: number; t_offset_ms: number }

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Composes captured frames into a labeled "film strip" PNG. One label-bar per
 * step; that step's frames are laid out in sub-rows that wrap when they exceed
 * the sheet width. This keeps tile resolution high — the model sees ~400px-wide
 * frames instead of squashed thumbnails — even with large bursts (10+ frames).
 */
export async function buildContactSheet(
  frames: CapturedFrame[],
  opts: ContactSheetOptions = {},
): Promise<Buffer> {
  const bg = `#${opts.bg ?? "0b0d12"}`;

  if (frames.length === 0) {
    return await sharp({ create: { width: 800, height: 200, channels: 3, background: bg } }).png().toBuffer();
  }

  const frameWidth = opts.frameWidth ?? 380;
  const maxSheetWidth = opts.maxSheetWidth ?? 1568;

  // How many frames fit on one visual sub-row.
  const tilesPerSubRow = Math.max(1, Math.floor((maxSheetWidth - COL_GAP) / (frameWidth + COL_GAP)));

  // Group frames by step.
  const groups = new Map<number, CapturedFrame[]>();
  for (const f of frames) {
    const arr = groups.get(f.step_index) ?? [];
    arr.push(f);
    groups.set(f.step_index, arr);
  }
  const orderedSteps = [...groups.entries()].sort((a, b) => a[0] - b[0]);

  // Resize tiles, keep aspect ratio.
  const stepTiles = new Map<number, { label: string; tiles: Tile[] }>();
  for (const [idx, list] of orderedSteps) {
    const tiles: Tile[] = [];
    for (const f of list) {
      const resized = await sharp(f.png)
        .resize({ width: frameWidth, withoutEnlargement: false })
        .png()
        .toBuffer({ resolveWithObject: true });
      tiles.push({
        png: resized.data,
        width: resized.info.width,
        height: resized.info.height,
        t_offset_ms: f.t_offset_ms,
      });
    }
    stepTiles.set(idx, { label: list[0].step_label, tiles });
  }

  // Plan the layout: for each step, label-bar + N sub-rows of tiles.
  // Sheet width is the max across all sub-rows (capped to maxSheetWidth).
  const layout: Array<{
    stepIdx: number;
    label: string;
    yLabel: number;
    subRows: Array<{ y: number; rowHeight: number; tiles: Tile[] }>;
  }> = [];

  let yCursor = ROW_GAP;
  let sheetWidth = 0;
  for (const [idx, info] of stepTiles) {
    const subRows: Array<{ y: number; rowHeight: number; tiles: Tile[] }> = [];
    const yLabel = yCursor;
    yCursor += LABEL_BAR_HEIGHT;
    for (const slice of chunk(info.tiles, tilesPerSubRow)) {
      const rowWidth = slice.reduce((a, t) => a + t.width + COL_GAP, COL_GAP);
      const rowHeight = Math.max(...slice.map((t) => t.height));
      sheetWidth = Math.max(sheetWidth, rowWidth);
      subRows.push({ y: yCursor, rowHeight, tiles: slice });
      yCursor += rowHeight + SUB_ROW_GAP;
    }
    yCursor = (yCursor - SUB_ROW_GAP) + ROW_GAP; // step-end gap (collapse trailing sub-row gap)
    layout.push({ stepIdx: idx, label: info.label, yLabel, subRows });
  }

  sheetWidth = Math.min(sheetWidth, maxSheetWidth);
  const sheetHeight = yCursor;

  const composites: sharp.OverlayOptions[] = [];
  for (const step of layout) {
    composites.push({
      input: svgRowLabel(sheetWidth, `step ${step.stepIdx + 1}: ${step.label}`),
      top: step.yLabel,
      left: 0,
    });
    for (const sub of step.subRows) {
      let x = COL_GAP;
      for (const tile of sub.tiles) {
        composites.push({ input: tile.png, top: sub.y, left: x });
        composites.push({
          input: svgFrameTag(tile.width, tile.height, `+${tile.t_offset_ms}ms`),
          top: sub.y,
          left: x,
        });
        x += tile.width + COL_GAP;
      }
    }
  }

  return await sharp({
    create: { width: sheetWidth, height: sheetHeight, channels: 3, background: bg },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
