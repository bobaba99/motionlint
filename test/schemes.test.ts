import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { captureScreenshot } from "../src/capture/screenshot.js";

const page = `<style>body{margin:0;background:#fff}@media (prefers-color-scheme: dark){body{background:#000}}</style><body></body>`;
const url = `data:text/html,${encodeURIComponent(page)}`;
const viewport = { name: "t", width: 60, height: 60 };

describe("colorScheme capture plumbing", () => {
  it("renders the dark media query when colorScheme is dark", async () => {
    const cap = await captureScreenshot({ url, viewport, fullPage: false, colorScheme: "dark" });
    const stats = await sharp(cap.screenshot).grayscale().stats();
    assert.ok(stats.channels[0].mean < 20, `expected near-black, got mean ${stats.channels[0].mean}`);
  });

  it("defaults to the light rendering", async () => {
    const cap = await captureScreenshot({ url, viewport, fullPage: false });
    const stats = await sharp(cap.screenshot).grayscale().stats();
    assert.ok(stats.channels[0].mean > 235, `expected near-white, got mean ${stats.channels[0].mean}`);
  });
});
