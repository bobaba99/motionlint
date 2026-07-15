import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditLayout, lintLayout } from "../src/lint/layout.js";
import type { DomSnapshot } from "../src/capture/dom.js";
import { renderAnimationAuditHtml } from "../src/tuner/audit_report.js";
import type { AnimationAudit } from "../src/tuner/lint.js";

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    url: "http://localhost:4173/",
    title: "Fixture",
    viewport: { width: 1280, height: 800 },
    page: { width: 1280, height: 2400 },
    elements: [],
    text_outline: [],
    forms: [],
    ctas: [],
    small_tap_targets: [],
    smallest_text: { px: 14, sample: "footer note" },
    body_font_px: 16,
    horizontal_overflow: false,
    overflow_amount_px: 0,
    type_size_count: 5,
    computed_color_pairs_under_threshold: [],
    loading_indicators: { spinners: 0, skeletons: 0, progressbars: 0 },
    empty_lists: [],
    qualitative_only: [],
    ...overrides,
  };
}

describe("layout linter", () => {
  it("returns no findings and a perfect score for a clean snapshot", () => {
    const audit = auditLayout(snapshot());
    assert.equal(audit.findings.length, 0);
    assert.equal(audit.score, 100);
  });

  it("flags horizontal overflow as critical with the measured amount", () => {
    const findings = lintLayout(snapshot({ horizontal_overflow: true, overflow_amount_px: 37 }));
    const f = findings.find((x) => x.category === "overflow");
    assert.ok(f);
    assert.equal(f.severity, "critical");
    assert.match(f.detail, /37px/);
  });

  it("maps each small tap target to a warning citing the 44px floor", () => {
    const findings = lintLayout(snapshot({
      small_tap_targets: [
        { tag: "a", text: "Terms", rect: { x: 0, y: 0, w: 60, h: 18 }, reason: "18px tall" },
        { tag: "button", text: "×", rect: { x: 10, y: 10, w: 20, h: 20 }, reason: "20x20" },
      ],
    }));
    const taps = findings.filter((x) => x.category === "tap_target");
    assert.equal(taps.length, 2);
    assert.ok(taps.every((x) => x.severity === "warning"));
    assert.match(taps[0].standard, /44/);
    assert.match(taps[0].location, /Terms/);
  });

  it("flags body font below 16px as a suggestion and text below 12px as a warning", () => {
    const small = lintLayout(snapshot({ body_font_px: 14 }));
    assert.equal(small.find((x) => x.category === "typography")?.severity, "suggestion");

    const tiny = lintLayout(snapshot({ smallest_text: { px: 10, sample: "legal line" } }));
    const f = tiny.find((x) => x.category === "typography" && x.severity === "warning");
    assert.ok(f);
    assert.match(f.location, /legal line/);
  });

  it("flags each low-contrast pair as a warning citing 4.5:1", () => {
    const findings = lintLayout(snapshot({
      computed_color_pairs_under_threshold: [{ text: "muted caption", ratio_estimate: 2.9 }],
    }));
    const f = findings.find((x) => x.category === "contrast");
    assert.ok(f);
    assert.equal(f.severity, "warning");
    assert.match(f.detail, /2\.9/);
    assert.match(f.standard, /4\.5/);
  });

  it("flags type-size sprawl (>8 distinct sizes) and empty lists as suggestions", () => {
    const findings = lintLayout(snapshot({
      type_size_count: 12,
      empty_lists: [{ selector: "ul.results", rect: { x: 0, y: 100, w: 600, h: 80 } }],
    }));
    assert.ok(findings.find((x) => x.category === "cohesion" && x.severity === "suggestion"));
    assert.ok(findings.find((x) => x.category === "content" && x.severity === "suggestion"));
  });

  it("scores with the house weights and sorts findings by severity", () => {
    const audit = auditLayout(snapshot({
      horizontal_overflow: true,
      overflow_amount_px: 12,
      body_font_px: 14,
      small_tap_targets: [{ tag: "a", text: "x", rect: { x: 0, y: 0, w: 10, h: 10 }, reason: "10x10" }],
    }));
    // 1 critical (25) + 1 warning (10) + 1 suggestion (3) = 38 penalty
    assert.equal(audit.score, 62);
    assert.equal(audit.findings[0].severity, "critical");
    assert.equal(audit.critical_count, 1);
    assert.equal(audit.warning_count, 1);
    assert.equal(audit.suggestion_count, 1);
  });
});

describe("layout section in audit HTML", () => {
  const animAudit: AnimationAudit = {
    url: "http://localhost:4173/",
    captured_at: "2026-07-14T00:00:00.000Z",
    viewport: { width: 1280, height: 800 },
    total_animations: 0,
    findings: [],
    critical_count: 0,
    warning_count: 0,
    suggestion_count: 0,
    score: 100,
  };

  it("renders a Layout section when a layout audit is supplied", () => {
    const layout = auditLayout(snapshot({ horizontal_overflow: true, overflow_amount_px: 20 }));
    const html = renderAnimationAuditHtml(animAudit, layout);
    assert.match(html, /Layout/);
    assert.match(html, /overflows horizontally/);
    assert.match(html, /75\/100|75/); // layout score: 100 - 25
  });

  it("renders unchanged without a layout audit", () => {
    const html = renderAnimationAuditHtml(animAudit);
    assert.doesNotMatch(html, /Layout audit/);
  });
});
