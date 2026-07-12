import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditAnimations, lintAnimation } from "../src/tuner/lint.js";
import { isEaseIn, isWeakBuiltin } from "../src/tuner/standards.js";
import type { DetectedAnimation, TunerCapture } from "../src/tuner/types.js";

function anim(overrides: Partial<DetectedAnimation> & { rawParams?: Record<string, unknown> }): DetectedAnimation {
  const { rawParams, ...rest } = overrides;
  return {
    id: "anim_1",
    selector: ".el",
    source: "css-transition",
    technical_name: "CSS transition",
    common_name: "element",
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    preview_html: "",
    preview_css: "",
    params: [{ name: "duration", label: "Duration", technical: "", min: 50, max: 2000, step: 50, value: 200, unit: "ms" }],
    presets: [],
    raw: { params: rawParams ?? {} },
    ...rest,
  };
}

function capture(animations: DetectedAnimation[]): TunerCapture {
  return {
    url: "http://x",
    captured_at: new Date().toISOString(),
    viewport: { width: 1280, height: 800 },
    animations,
    capture_id: "cap",
    page_styles: { backgroundColor: "#fff", backgroundImage: "none", color: "#000", fontFamily: "sans-serif" },
  };
}

describe("easing classifiers", () => {
  it("flags ease-in keyword and accelerating cubic-beziers", () => {
    assert.equal(isEaseIn("ease-in"), true);
    assert.equal(isEaseIn("cubic-bezier(0.42, 0, 1, 1)"), true); // classic ease-in
    assert.equal(isEaseIn("ease-out"), false);
    assert.equal(isEaseIn("cubic-bezier(0.23, 1, 0.32, 1)"), false); // strong ease-out
  });

  it("recognizes weak built-in easings", () => {
    assert.equal(isWeakBuiltin("ease"), true);
    assert.equal(isWeakBuiltin("linear"), true);
    assert.equal(isWeakBuiltin("cubic-bezier(0.77, 0, 0.175, 1)"), false);
  });
});

describe("lintAnimation", () => {
  it("flags ease-in on a modal entrance", () => {
    const f = lintAnimation(anim({
      common_name: "Signup modal",
      rawParams: { property: "opacity", duration: "200ms", timing: "ease-in" },
    }));
    const easing = f.find((x) => x.category === "easing");
    assert.ok(easing, "expected an easing finding");
    assert.equal(easing!.severity, "warning");
    assert.match(easing!.suggested!, /cubic-bezier/);
  });

  it("flags durations over the 300ms UI ceiling", () => {
    const f = lintAnimation(anim({
      params: [{ name: "duration", label: "Duration", technical: "", min: 50, max: 2000, step: 50, value: 800, unit: "ms" }],
      rawParams: { property: "transform", duration: "800ms", timing: "ease-out" },
    }));
    const dur = f.find((x) => x.category === "duration");
    assert.ok(dur, "expected a duration finding");
    assert.equal(dur!.current, "800ms");
  });

  it("allows a modal up to 500ms", () => {
    const f = lintAnimation(anim({
      common_name: "Dialog drawer",
      selector: ".drawer",
      params: [{ name: "duration", label: "Duration", technical: "", min: 50, max: 2000, step: 50, value: 420, unit: "ms" }],
      rawParams: { property: "transform", duration: "420ms", timing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    }));
    assert.equal(f.find((x) => x.category === "duration"), undefined, "420ms modal should be within budget");
  });

  it("flags scale(0) entrances from captured CSS", () => {
    const f = lintAnimation(anim({
      preview_css: ".el { transform: scale(0); }",
      rawParams: { property: "transform", duration: "200ms", timing: "ease-out" },
    }));
    const phys = f.find((x) => x.category === "physicality");
    assert.ok(phys, "expected a physicality finding");
    assert.equal(phys!.suggested, "scale(0.95)");
  });

  it("does not flag scale(0.95)", () => {
    const f = lintAnimation(anim({
      preview_css: ".el { transform: scale(0.95); }",
      rawParams: { property: "transform", duration: "200ms", timing: "ease-out" },
    }));
    assert.equal(f.find((x) => x.category === "physicality"), undefined);
  });

  it("flags transition: all and layout-property animation", () => {
    const f = lintAnimation(anim({
      rawParams: { property: "all", duration: "200ms", timing: "ease-out" },
    }));
    assert.ok(f.some((x) => x.title === "transition: all"));

    const g = lintAnimation(anim({
      rawParams: { property: "height, width", duration: "200ms", timing: "ease-out" },
    }));
    assert.ok(g.some((x) => x.category === "performance" && /layout/i.test(x.title)));
  });

  it("stays quiet on a clean animation", () => {
    const f = lintAnimation(anim({
      common_name: "Toast",
      params: [{ name: "duration", label: "Duration", technical: "", min: 50, max: 2000, step: 50, value: 200, unit: "ms" }],
      rawParams: { property: "transform, opacity", duration: "200ms", timing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      preview_css: ".el { transform: translateY(8px); }",
    }));
    assert.equal(f.length, 0, `expected no findings, got: ${JSON.stringify(f)}`);
  });
});

describe("auditAnimations", () => {
  it("scores and counts a mixed capture", () => {
    const audit = auditAnimations(capture([
      anim({ id: "a1", common_name: "Modal", rawParams: { property: "opacity", duration: "200ms", timing: "ease-in" } }),
      anim({
        id: "a2",
        params: [{ name: "duration", label: "Duration", technical: "", min: 50, max: 2000, step: 50, value: 200, unit: "ms" }],
        rawParams: { property: "transform, opacity", duration: "200ms", timing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      }),
    ]));
    assert.equal(audit.total_animations, 2);
    assert.ok(audit.findings.length >= 1);
    assert.ok(audit.score < 100 && audit.score >= 0);
    // findings sorted with more-severe first
    assert.ok(severityValue(audit.findings[0].severity) <= severityValue(audit.findings[audit.findings.length - 1].severity));
  });

  it("flags easing-token sprawl as a cohesion finding", () => {
    const anims = ["0.1,0.2,0.3,0.4", "0.5,0.6,0.7,0.8", "0.11,0.22,0.33,0.44", "0.9,0.8,0.7,0.6"].map((c, i) =>
      anim({ id: `c${i}`, rawParams: { property: "transform", duration: "200ms", timing: `cubic-bezier(${c})` } }),
    );
    const audit = auditAnimations(capture(anims));
    assert.ok(audit.findings.some((f) => f.category === "cohesion"));
  });
});

function severityValue(s: string): number {
  return s === "critical" ? 0 : s === "warning" ? 1 : 2;
}
