import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureStateGrid, GRID_STATES } from "../src/capture/states.js";
import { buildPrompt } from "../src/analysis/prompt.js";
import { runReview } from "../src/pipeline.js";
import { defaultConfig } from "../src/config/loader.js";

describe("state-grid prompt mode", () => {
  it("explains grid semantics and constrains categories", async () => {
    const prompt = await buildPrompt({
      viewportName: "interaction-states",
      stateGrid: { states: GRID_STATES, elements: ["Log in", "Start free"] },
    });
    assert.match(prompt, /Interaction-state grid mode/);
    assert.match(prompt, /default \/ hover \/ focus \/ active/);
    assert.match(prompt, /"Log in", "Start free"/);
    assert.match(prompt, /WCAG 2\.4\.7/);
  });
});

describe("captureStateGrid (live demo app)", () => {
  it("composes a labeled PNG grid from real elements", async () => {
    const grid = await captureStateGrid({
      url: "http://localhost:4173/",
      viewport: { name: "desktop", width: 1440, height: 900 },
      waitFor: "networkidle",
      maxElements: 3,
    });
    assert.ok(grid, "demo app has interactive elements");
    assert.ok(grid!.elements.length >= 1 && grid!.elements.length <= 3);
    assert.equal(grid!.states.length, 4);
    // PNG magic bytes
    assert.deepEqual([...grid!.buffer.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(grid!.width > 1000 && grid!.height > 100, `sane dims, got ${grid!.width}x${grid!.height}`);
  });
});

describe("pipeline --state-grid integration (mock provider)", () => {
  let dir: string;
  after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("adds an interaction-states entry to the report", async () => {
    dir = await mkdtemp(join(tmpdir(), "ml-grid-"));
    const config = structuredClone(defaultConfig);
    config.screenshotDir = join(dir, "shots");
    config.videoDir = join(dir, "videos");
    config.reportDir = join(dir, "reports");
    config.memory.enabled = false;

    const result = await runReview({
      url: "http://localhost:4173/",
      config,
      provider: "mock",
      viewports: ["desktop"],
      outputPath: null,
      stateGrid: true,
    });

    const names = result.report.analyses.map((e) => e.capture.viewport.name);
    assert.deepEqual(names, ["desktop", "interaction-states"]);
    const gridEntry = result.report.analyses[1];
    assert.equal(gridEntry.capture.fullPage, false);
    assert.ok(gridEntry.capture.screenshot.length > 0);
    assert.equal(result.report.usage?.calls, 2, "grid analysis is a billed call");
  });
});
