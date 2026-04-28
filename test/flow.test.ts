import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { runFlow } from "../src/flow/runner.js";
import { renderFlowMarkdownReport } from "../src/flow/report.js";
import { parseInlineSteps, loadFlowSpec } from "../src/flow/spec.js";
import { buildContactSheet } from "../src/capture/contact_sheet.js";
import type { CapturedFrame } from "../src/flow/types.js";

const DEMO_URL = process.env.UXV_DEMO_URL ?? "http://localhost:4173/";

describe("flow spec parser", () => {
  it("parses semicolon-separated inline DSL", () => {
    const steps = parseInlineSteps('navigate /signup; type input#email=a@b.co; click button[type=submit]; wait 500; capture "after submit"');
    assert.equal(steps.length, 5);
    assert.equal(steps[0].do, "navigate");
    assert.equal(steps[0].value, "/signup");
    assert.equal(steps[1].do, "type");
    assert.equal(steps[1].selector, "input#email");
    assert.equal(steps[1].value, "a@b.co");
    assert.equal(steps[3].do, "wait");
    assert.equal(steps[3].ms, 500);
    assert.equal(steps[4].label, "after submit");
  });

  it("rejects unknown actions", () => {
    assert.throws(() => parseInlineSteps("punch button"), /Unknown flow action/);
  });

  it("loads JSON spec from file", async () => {
    const spec = await loadFlowSpec(resolve("flows/loading-state.json"));
    assert.equal(spec.name, "loading-state-feedback");
    assert.ok(spec.steps.length >= 3);
    assert.ok(Array.isArray(spec.expected_animations));
  });
});

describe("contact sheet compositor", () => {
  it("renders an empty placeholder when given zero frames", async () => {
    const buf = await buildContactSheet([]);
    assert.ok(buf.length > 100, "should produce a non-empty PNG even on empty input");
  });

  it("composites multiple frames into one PNG", async () => {
    // Build 3 tiny dummy PNG buffers via sharp.
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    const tiny = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#2563eb" } }).png().toBuffer();
    const frames: CapturedFrame[] = [
      { step_index: 0, step_label: "click button", frame_index: 0, t_offset_ms: 0,   png: tiny },
      { step_index: 0, step_label: "click button", frame_index: 1, t_offset_ms: 250, png: tiny },
      { step_index: 1, step_label: "wait",         frame_index: 0, t_offset_ms: 0,   png: tiny },
    ];
    const sheet = await buildContactSheet(frames);
    assert.ok(sheet.length > 1000);
  });
});

describe("flow runner end-to-end (mock provider)", () => {
  it("runs an inline-DSL signup flow against the demo app and produces a report", async () => {
    await mkdir(resolve(".motionlint/flows"), { recursive: true });
    const spec = await loadFlowSpec(
      'click input#name; type input#name=Ada; click input#email; type input#email=ada@example.com; click button[type=submit]; wait 600; capture "post submit"',
      DEMO_URL.replace(/\/$/, "") + "/signup",
    );
    spec.name = "test-signup-flow";
    const report = await runFlow({
      spec,
      provider: "mock",
      artifactDir: resolve(".motionlint/flows"),
      videoDir: resolve(".motionlint/videos"),
      noImplicitBursts: false,
    });
    assert.equal(report.flow_name, "test-signup-flow");
    assert.equal(report.provider, "mock");
    assert.ok(report.capture.frames.length > 0);
    assert.ok(report.contact_sheet_path);
    // Frame intervals target 50ms (16 frames × 750ms burst window). Below the
    // 60Hz monitor frame rate (16.7ms) is impossible without dedicated capture
    // hardware; 50ms is half the 100ms human-detection threshold and below
    // industry-typical 100ms minimum animation intervals. We assert <70ms with
    // some slack for setTimeout granularity.
    const burst = report.capture.step_results.find((r) => r.frame_indices.length > 1);
    assert.ok(burst, "expected at least one burst with >1 frames");
    const burstFrames = burst!.frame_indices.map((i) => report.capture.frames[i]);
    const intervals = burstFrames.slice(1).map((f, i) => f.t_offset_ms - burstFrames[i].t_offset_ms);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    assert.ok(avg < 70, `expected sub-70ms intervals (50ms target), got ${avg.toFixed(1)}ms`);

    const md = renderFlowMarkdownReport(report);
    assert.match(md, /MotionLint Flow Report/);
    assert.match(md, /Steps executed/);
    assert.match(md, /Prompt for Claude Code/);
  });

  it("loads preferences markdown, embeds it in the prompt and report, and produces a CC handoff block", async () => {
    const spec = await loadFlowSpec(
      'click input#name; type input#name=Ada; capture "after name"',
      DEMO_URL.replace(/\/$/, "") + "/signup",
    );
    spec.name = "test-prefs-flow";
    const report = await runFlow({
      spec,
      provider: "mock",
      artifactDir: resolve(".motionlint/flows"),
      preferencesPath: resolve("flows/preferences.md"),
      noImplicitBursts: false,
    });
    assert.ok(report.preferences_md);
    assert.match(report.preferences_md!, /motion philosophy/i);

    const md = renderFlowMarkdownReport(report);
    assert.match(md, /## Team preferences/);
    assert.match(md, /Motion philosophy/);
    assert.match(md, /## Prompt for Claude Code/);
    // CC handoff should round-trip the findings as JSON.
    const block = md.match(/```json\n([\s\S]*?)\n```/);
    if (block) {
      const parsed = JSON.parse(block[1]) as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(parsed));
    }
  });
});
