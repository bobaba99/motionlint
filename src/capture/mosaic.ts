import sharp from "sharp";
import type { CaptureResult, Viewport } from "../types.js";
import { captureScreenshot } from "./screenshot.js";

export interface MosaicCaptureOptions {
  url: string;
  viewports: Viewport[];
  waitFor?: string;
  waitTimeout?: number;
  screenshotDir?: string;
  /** Resize each tile so the mosaic fits within this max width. */
  maxWidth?: number;
  /** Vertical gap between tiles (px). */
  gap?: number;
  /** Background color (hex without #). */
  bg?: string;
}

export interface MosaicResult {
  /** PNG buffer of the stacked mosaic. */
  buffer: Buffer;
  /** The per-viewport captures used to build the mosaic. */
  captures: CaptureResult[];
  /** Vertical Y offsets of each tile in the mosaic, for downstream consumers. */
  tile_offsets: Array<{ name: string; width: number; height: number; y: number }>;
}

const LABEL_BAR_HEIGHT = 28;
const LABEL_FONT_SIZE = 14;

function svgLabel(width: number, text: string): Buffer {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_BAR_HEIGHT}">
      <rect x="0" y="0" width="${width}" height="${LABEL_BAR_HEIGHT}" fill="#0b0d12"/>
      <rect x="0" y="${LABEL_BAR_HEIGHT - 1}" width="${width}" height="1" fill="#2a2f3d"/>
      <text x="12" y="${LABEL_BAR_HEIGHT - 9}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
            font-size="${LABEL_FONT_SIZE}" fill="#e7eaf0">${safe}</text>
    </svg>`,
  );
}

/**
 * Captures the same URL at multiple viewports and stacks the results into one
 * tall image with a labeled bar above each tile. The model receives one image
 * and can directly compare layouts across viewports — the single biggest lever
 * for catching viewport-conditional faults at L3.
 */
export async function captureMosaic(opts: MosaicCaptureOptions): Promise<MosaicResult> {
  const captures: CaptureResult[] = [];
  for (const viewport of opts.viewports) {
    const cap = await captureScreenshot({
      url: opts.url,
      viewport,
      fullPage: true,
      waitFor: opts.waitFor ?? "networkidle",
      waitTimeout: opts.waitTimeout ?? 10_000,
      screenshotDir: opts.screenshotDir,
    });
    captures.push(cap);
  }

  const maxWidth = opts.maxWidth ?? 1200;
  const gap = opts.gap ?? 16;
  const bg = opts.bg ?? "0b0d12";

  // Resize each tile to maxWidth (preserving aspect ratio); compute layout.
  const tiles: Array<{ name: string; width: number; height: number; png: Buffer }> = [];
  for (const cap of captures) {
    const resized = await sharp(cap.screenshot)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    tiles.push({
      name: cap.viewport.name,
      width: resized.info.width,
      height: resized.info.height,
      png: resized.data,
    });
  }

  const totalHeight = tiles.reduce((acc, t) => acc + LABEL_BAR_HEIGHT + t.height + gap, gap);
  const totalWidth = Math.max(...tiles.map((t) => t.width));

  const composites: sharp.OverlayOptions[] = [];
  const tile_offsets: Array<{ name: string; width: number; height: number; y: number }> = [];
  let y = gap;
  for (const tile of tiles) {
    const labelText = `${tile.name.toUpperCase()}  •  ${tile.width}px wide  •  ${tile.height}px tall`;
    composites.push({ input: svgLabel(totalWidth, labelText), top: y, left: 0 });
    y += LABEL_BAR_HEIGHT;
    composites.push({ input: tile.png, top: y, left: 0 });
    tile_offsets.push({ name: tile.name, width: tile.width, height: tile.height, y });
    y += tile.height + gap;
  }

  const buffer = await sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 3,
      background: `#${bg}`,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return { buffer, captures, tile_offsets };
}
