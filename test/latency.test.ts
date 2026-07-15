import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { frameDiffScore, measureFeedbackLatency, INSTANT_MS } from "../src/flow/latency.js";
import { renderFlowMarkdownReport } from "../src/flow/report.js";
import type { CapturedFrame, FlowCaptureResult, FlowStepResult, FlowReport } from "../src/flow/types.js";

function solid(rgb: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png().toBuffer();
}

function frame(step: number, idx: number, t: number, png: Buffer): CapturedFrame {
  return { step_index: step, step_label: `step-${step}`, frame_index: idx, t_offset_ms: t, png };
}

function capture(frames: CapturedFrame[], steps: FlowStepResult[]): FlowCaptureResult {
  return {
    spec: { name: "t", url: "http://localhost:4173/", steps: [] },
    frames,
    total_duration_ms: 1000,
    step_results: steps,
  };
}

function clickStep(index: number, frameIndices: number[]): FlowStepResult {
  return {
    step_index: index,
    step: { do: "click", selector: "button" },
    t_start_ms: 0,
    t_end_ms: 10,
    success: true,
    frame_indices: frameIndices,
  };
}

describe("frameDiffScore", () => {
  it("is ~0 for identical frames and large for different frames", async () => {
    const white = await solid([255, 255, 255]);
    const gray = await solid([128, 128, 128]);
    assert.ok((await frameDiffScore(white, white)) < 0.01);
    assert.ok((await frameDiffScore(white, gray)) > 50);
  });
});

describe("measureFeedbackLatency", () => {
  it("reports the first visually-changed frame's offset as feedback latency", async () => {
    const white = await solid([255, 255, 255]);
    const gray = await solid([200, 200, 200]);
    const cap = capture(
      [frame(0, 0, 0, white), frame(0, 1, 50, white), frame(0, 2, 150, gray)],
      [clickStep(0, [0, 1, 2])],
    );
    const [m] = await measureFeedbackLatency(cap);
    assert.equal(m.feedback_ms, 150);
    assert.equal(m.verdict, "delayed");
  });

  it("verdicts instant when feedback lands within INSTANT_MS", async () => {
    const white = await solid([255, 255, 255]);
    const gray = await solid([200, 200, 200]);
    const cap = capture(
      [frame(0, 0, 0, white), frame(0, 1, 50, gray)],
      [clickStep(0, [0, 1])],
    );
    const [m] = await measureFeedbackLatency(cap);
    assert.equal(m.feedback_ms, 50);
    assert.ok(m.feedback_ms <= INSTANT_MS);
    assert.equal(m.verdict, "instant");
  });

  it("verdicts none when no frame in the burst differs", async () => {
    const white = await solid([255, 255, 255]);
    const cap = capture(
      [frame(0, 0, 0, white), frame(0, 1, 50, white), frame(0, 2, 100, white)],
      [clickStep(0, [0, 1, 2])],
    );
    const [m] = await measureFeedbackLatency(cap);
    assert.equal(m.feedback_ms, null);
    assert.equal(m.verdict, "none");
  });

  it("skips non-interaction steps, failed steps, and bursts with fewer than 2 frames", async () => {
    const white = await solid([255, 255, 255]);
    const cap = capture(
      [frame(0, 0, 0, white), frame(1, 0, 0, white)],
      [
        { ...clickStep(0, [0]), step: { do: "navigate" } },
        { ...clickStep(1, [1]), success: false },
      ],
    );
    assert.deepEqual(await measureFeedbackLatency(cap), []);
  });
});

describe("latency section in flow report", () => {
  it("renders a feedback-latency table and flags none/delayed verdicts", async () => {
    const white = await solid([255, 255, 255]);
    const report: FlowReport = {
      generated_at: "2026-07-14T00:00:00.000Z",
      flow_name: "signup",
      url: "http://localhost:4173/",
      provider: "mock",
      model: "mock",
      capture: capture([frame(0, 0, 0, white)], []),
      analysis: { overall_score: 8, summary: "ok", issues: [], strengths: [], viewport: "desktop" },
      latency: [
        { step_index: 0, step_label: "click submit", action: "click", feedback_ms: null, burst_window_ms: 750, verdict: "none" },
        { step_index: 1, step_label: "type email", action: "type", feedback_ms: 50, burst_window_ms: 750, verdict: "instant" },
      ],
    };
    const md = renderFlowMarkdownReport(report);
    assert.match(md, /Input feedback latency/);
    assert.match(md, /click submit/);
    assert.match(md, /no visual feedback/i);
    assert.match(md, /50ms/);
  });
});
