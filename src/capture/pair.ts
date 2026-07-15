/**
 * Composes labeled screenshots side by side into one strip — used by
 * comparison review (CURRENT | BASELINE) and the color-scheme sweep
 * (LIGHT | DARK | FORCED COLORS). Panels are scaled to a common row height
 * so the model compares like with like.
 */
import sharp from "sharp";

export interface StripPanel {
  label: string;
  png: Buffer;
}

const LABEL_BAR_H = 44;
const GUTTER = 16;
const MAX_ROW_H = 1200;

function labelSvg(text: string, width: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${LABEL_BAR_H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111318"/>
      <text x="14" y="${LABEL_BAR_H / 2 + 5}" font-family="Menlo, monospace" font-size="16" fill="#e8e8ec" letter-spacing="2">${text.toUpperCase()}</text>
    </svg>`,
  );
}

export async function composeLabeledStrip(panels: StripPanel[]): Promise<Buffer> {
  if (panels.length < 2) throw new Error("composeLabeledStrip needs at least two panels");

  const metas = await Promise.all(panels.map((p) => sharp(p.png).metadata()));
  const rowH = Math.min(MAX_ROW_H, ...metas.map((m) => m.height ?? MAX_ROW_H));

  const resized = await Promise.all(
    panels.map(async (p) => {
      const buf = await sharp(p.png).resize({ height: rowH, fit: "inside" }).png().toBuffer();
      const meta = await sharp(buf).metadata();
      return { label: p.label, png: buf, width: meta.width ?? 0 };
    }),
  );

  const totalW = resized.reduce((sum, p) => sum + p.width, 0) + GUTTER * (resized.length - 1);
  const totalH = LABEL_BAR_H + rowH;

  const composites: sharp.OverlayOptions[] = [];
  let x = 0;
  for (const p of resized) {
    composites.push({ input: labelSvg(p.label, p.width), left: x, top: 0 });
    composites.push({ input: p.png, left: x, top: LABEL_BAR_H });
    x += p.width + GUTTER;
  }

  return sharp({
    create: { width: totalW, height: totalH, channels: 3, background: { r: 17, g: 19, b: 24 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
