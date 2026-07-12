import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderReviewHtmlReport } from "../src/report/html.js";
import { renderAnimationAuditHtml } from "../src/tuner/audit_report.js";
import { auditAnimations } from "../src/tuner/lint.js";
import { sampleOutDir } from "./sample-output.js";
import type { ReviewReport } from "../src/types.js";
import type { DetectedAnimation, TunerCapture } from "../src/tuner/types.js";

function sampleReport(): ReviewReport {
  return {
    timestamp: "2026-07-12T10:00:00.000Z",
    url: "https://example.com",
    provider: "anthropic",
    model: "claude-opus-4-8",
    aggregate_score: 7,
    critical_count: 1,
    warning_count: 1,
    suggestion_count: 1,
    omitted: { by_cap: 0, by_baseline: 0, by_memory: 0 },
    analyses: [
      {
        capture: {
          url: "https://example.com",
          viewport: { name: "desktop", width: 1440, height: 900 },
          screenshot: Buffer.from(""),
          fullPage: true,
          timestamp: "2026-07-12T10:00:00.000Z",
        },
        analysis: {
          overall_score: 7,
          summary: "Clean hero, but the primary CTA is low-contrast and the mobile nav is hidden.",
          viewport: "desktop",
          strengths: ["Strong typographic hierarchy", "Consistent spacing rhythm"],
          issues: [
            { category: "contrast", severity: "critical", location: "hero CTA", issue: "Primary button text is 2.8:1 against its background.", why_it_matters: "Fails WCAG AA; low-vision users can't read the label.", fix: "Darken the button or lighten the text to reach 4.5:1." },
            { category: "spacing", severity: "warning", location: "footer", issue: "Footer columns have inconsistent gutters.", why_it_matters: "Uneven rhythm reads as unpolished.", fix: "Use a single 24px gutter token across all footer columns." },
            { category: "content", severity: "suggestion", location: "empty state", issue: "Empty dashboard shows only a spinner.", why_it_matters: "Users don't know what to do first.", fix: "Add a one-line prompt and a primary action.", hash: "a1b2c3", previously_seen: 2 },
          ],
        },
      },
    ],
  };
}

function anim(o: Partial<DetectedAnimation> & { rawParams?: Record<string, unknown> }): DetectedAnimation {
  const { rawParams, ...rest } = o;
  return {
    id: "a1", selector: ".el", source: "css-transition", technical_name: "CSS transition",
    common_name: "element", bbox: { x: 0, y: 0, w: 10, h: 10 }, preview_html: "", preview_css: "",
    params: [{ name: "duration", label: "Duration", technical: "", min: 50, max: 2000, step: 50, value: 200, unit: "ms" }],
    presets: [], raw: { params: rawParams ?? {} }, ...rest,
  };
}

describe("review HTML report", () => {
  it("renders a self-contained document with findings and before/after", async () => {
    const html = renderReviewHtmlReport(sampleReport());
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /MotionLint Design Review/);
    assert.match(html, /Suggested fix/);
    assert.match(html, /prefers-reduced-motion/);
    assert.match(html, /Emil Kowalski/);
    // dogfoods the strong easing token
    assert.match(html, /cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    await writeFile(resolve(await sampleOutDir(), "sample-review.html"), html, "utf8");
  });
});

describe("animation audit HTML report", () => {
  it("renders findings with an easing curve comparison", async () => {
    const capture: TunerCapture = {
      url: "https://example.com", captured_at: "2026-07-12T10:00:00.000Z",
      viewport: { width: 1280, height: 800 },
      capture_id: "cap", page_styles: { backgroundColor: "#fff", backgroundImage: "none", color: "#000", fontFamily: "sans-serif" },
      animations: [
        anim({ id: "m", common_name: "Signup modal", selector: ".modal", rawParams: { property: "opacity", duration: "200ms", timing: "ease-in" } }),
        anim({ id: "d", common_name: "Card grid", selector: ".card",
          params: [{ name: "duration", label: "Duration", technical: "", min: 50, max: 2000, step: 50, value: 750, unit: "ms" }],
          rawParams: { property: "transform", duration: "750ms", timing: "ease-out" } }),
        anim({ id: "p", common_name: "Badge pop", selector: ".badge", source: "css-keyframes",
          preview_css: "@keyframes pop { from { transform: scale(0); } }", rawParams: { name: "pop", duration: "180ms", timing: "ease-out" } }),
      ],
    };
    const audit = auditAnimations(capture);
    const html = renderAnimationAuditHtml(audit);
    assert.match(html, /MotionLint Animation Audit/);
    assert.match(html, /<svg/); // curve comparison present
    assert.match(html, /Standard/);
    assert.match(html, /scale\(0\.95\)/);
    await writeFile(resolve(await sampleOutDir(), "sample-audit.html"), html, "utf8");
  });

  it("renders a clean state when there are no findings", () => {
    const capture: TunerCapture = {
      url: "https://example.com", captured_at: "2026-07-12T10:00:00.000Z",
      viewport: { width: 1280, height: 800 }, capture_id: "cap",
      page_styles: { backgroundColor: "#fff", backgroundImage: "none", color: "#000", fontFamily: "sans-serif" },
      animations: [anim({ rawParams: { property: "transform, opacity", duration: "200ms", timing: "cubic-bezier(0.23, 1, 0.32, 1)" } })],
    };
    const html = renderAnimationAuditHtml(auditAnimations(capture));
    assert.match(html, /on-standard/);
  });
});
