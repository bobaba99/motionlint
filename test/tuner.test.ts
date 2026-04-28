import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractAnimations } from "../src/tuner/extract.js";
import { renderTunerHTML } from "../src/tuner/render.js";

const DEMO_URL = process.env.UXV_DEMO_URL ?? "http://localhost:4173/";

describe("Animation Tuner", () => {
  it("extracts animations from the demo landing page", async () => {
    const capture = await extractAnimations({
      url: DEMO_URL,
      viewport: { width: 1280, height: 800 },
      settleMs: 1500,
    });
    assert.ok(capture.animations.length > 0, "expected at least one animation on the demo page");
    // Each detected animation must have a stable id, selector, params, and presets.
    for (const a of capture.animations) {
      assert.ok(a.id);
      assert.ok(a.selector);
      assert.ok(a.params.length > 0, `animation ${a.id} (${a.source}) has no parameters`);
      assert.ok(a.presets.length > 0);
    }
  });

  it("renders a self-contained interactive tuner HTML document and writes a sample to disk", async () => {
    const capture = await extractAnimations({
      url: DEMO_URL,
      viewport: { width: 1280, height: 800 },
      settleMs: 1500,
    });
    const html = renderTunerHTML(capture);
    assert.match(html, /MotionLint · Animation Tuner/);
    assert.match(html, /Export prompt for Claude Code/);
    assert.match(html, /<script>window\.__ML_CAPTURE = /);
    assert.match(html, /<div class="preview-frame" data-anim=/);
    assert.match(html, /attachShadow\(\{ mode: 'open' \}\)/);
    assert.match(html, /<input type="range"/);
    assert.match(html, /<select data-anim=/);

    const out = resolve("eval/results/sample-tuner.html");
    await mkdir(resolve("eval/results"), { recursive: true });
    await writeFile(out, html, "utf8");
  });
});
