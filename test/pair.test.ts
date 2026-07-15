import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { composeLabeledStrip } from "../src/capture/pair.js";

const solid = (w: number, h: number, gray: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: gray, g: gray, b: gray } } }).png().toBuffer();

describe("composeLabeledStrip", () => {
  it("lays panels side by side with a label bar", async () => {
    const a = await solid(200, 400, 250);
    const b = await solid(200, 400, 30);
    const strip = await composeLabeledStrip([
      { label: "CURRENT", png: a },
      { label: "BASELINE", png: b },
    ]);
    const meta = await sharp(strip).metadata();
    assert.ok((meta.width ?? 0) >= 400, "two panels side by side");
    assert.ok((meta.height ?? 0) > 400, "label bar adds height");
  });

  it("normalizes panels of different heights to one row height", async () => {
    const a = await solid(200, 400, 250);
    const b = await solid(200, 800, 30);
    const strip = await composeLabeledStrip([
      { label: "A", png: a },
      { label: "B", png: b },
    ]);
    const meta = await sharp(strip).metadata();
    assert.ok((meta.height ?? 0) <= 400 + 80, "tall panel scaled down, not stacked");
  });

  it("rejects fewer than two panels", async () => {
    const a = await solid(100, 100, 128);
    await assert.rejects(() => composeLabeledStrip([{ label: "only", png: a }]), /at least two/);
  });
});
