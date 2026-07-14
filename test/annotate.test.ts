import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveElementRefs } from "../src/analysis/annotate.js";
import { parseAnalysisResponse } from "../src/analysis/parser.js";
import { buildPrompt } from "../src/analysis/prompt.js";
import { renderReviewHtmlReport } from "../src/report/html.js";
import { runReview } from "../src/pipeline.js";
import { defaultConfig } from "../src/config/loader.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalysisResult, ReviewReport, UXIssue } from "../src/types.js";
import type { DomSnapshot } from "../src/capture/dom.js";

function issue(overrides: Partial<UXIssue> = {}): UXIssue {
  return {
    category: "hierarchy",
    severity: "warning",
    location: "hero",
    issue: "CTA blends into the background.",
    why_it_matters: "Users miss it.",
    fix: "Raise contrast.",
    ...overrides,
  };
}

function analysis(issues: UXIssue[]): AnalysisResult {
  return { overall_score: 6, summary: "s", issues, strengths: [], viewport: "desktop" };
}

const DOM = {
  page: { width: 1000, height: 2000 },
  elements: [
    { ref: "E1", selector: "a.cta", label: "Start free", rect: { x: 100, y: 50, w: 200, h: 40 } },
    { ref: "E2", selector: "h1", label: "Headline", rect: { x: 100, y: 120, w: 600, h: 80 } },
  ],
} as unknown as DomSnapshot;

describe("parser element_ref coercion", () => {
  it("accepts well-formed refs and normalizes case", () => {
    const raw = JSON.stringify({
      overall_score: 7, summary: "ok", strengths: [], viewport: "desktop",
      issues: [{ category: "hierarchy", severity: "warning", location: "x", issue: "y", why_it_matters: "z", fix: "f", element_ref: "e3" }],
    });
    const parsed = parseAnalysisResponse(raw, "desktop");
    assert.equal(parsed.issues[0].element_ref, "E3");
  });

  it("drops malformed refs", () => {
    const raw = JSON.stringify({
      overall_score: 7, summary: "ok", strengths: [], viewport: "desktop",
      issues: [{ category: "hierarchy", severity: "warning", location: "x", issue: "y", why_it_matters: "z", fix: "f", element_ref: "button#go" }],
    });
    const parsed = parseAnalysisResponse(raw, "desktop");
    assert.equal(parsed.issues[0].element_ref, undefined);
  });
});

describe("resolveElementRefs", () => {
  it("attaches the rect for known refs", () => {
    const out = resolveElementRefs(analysis([issue({ element_ref: "E1" })]), DOM);
    assert.deepEqual(out.issues[0].element_rect, { x: 100, y: 50, w: 200, h: 40 });
    assert.equal(out.issues[0].element_ref, "E1");
  });

  it("drops refs the snapshot does not know", () => {
    const out = resolveElementRefs(analysis([issue({ element_ref: "E99" })]), DOM);
    assert.equal(out.issues[0].element_ref, undefined);
    assert.equal(out.issues[0].element_rect, undefined);
  });

  it("is a no-op without a snapshot", () => {
    const out = resolveElementRefs(analysis([issue({ element_ref: "E1" })]), undefined);
    assert.equal(out.issues[0].element_ref, undefined, "uncheckable refs are dropped");
  });
});

describe("prompt elements section", () => {
  it("lists refs and the element_ref instruction", async () => {
    const prompt = await buildPrompt({ viewportName: "desktop", elements: DOM.elements });
    assert.match(prompt, /## Interactive elements \(stable refs\)/);
    assert.match(prompt, /E1 — <a\.cta> "Start free" at \(100, 50\) 200×40px/);
    assert.match(prompt, /"element_ref": "E3"/);
  });

  it("omits the section without elements", async () => {
    const prompt = await buildPrompt({ viewportName: "desktop" });
    assert.doesNotMatch(prompt, /Interactive elements/);
  });
});

describe("html annotation overlays", () => {
  it("draws percent-positioned boxes for issues with rects", () => {
    const report: ReviewReport = {
      timestamp: "t", url: "http://x", provider: "mock", model: "m",
      aggregate_score: 6, critical_count: 0, warning_count: 1, suggestion_count: 0,
      omitted: { by_cap: 0, by_baseline: 0, by_memory: 0 },
      analyses: [{
        capture: {
          url: "http://x",
          viewport: { name: "desktop", width: 1000, height: 800 },
          screenshot: Buffer.from("fakepng"),
          fullPage: true,
          timestamp: "t",
          dom: DOM,
        },
        analysis: analysis([issue({ element_ref: "E1", element_rect: { x: 100, y: 50, w: 200, h: 40 } })]),
      }],
    };
    const html = renderReviewHtmlReport(report);
    assert.match(html, /class="anno sev-warning"/);
    assert.match(html, /left:10\.00%/);
    assert.match(html, /top:2\.50%/);
    assert.match(html, /width:20\.00%/);
    assert.match(html, /anno-tag">E1</);
  });

  it("skips overlays for viewport-only captures where rects would misalign", () => {
    const report: ReviewReport = {
      timestamp: "t", url: "http://x", provider: "mock", model: "m",
      aggregate_score: 6, critical_count: 0, warning_count: 1, suggestion_count: 0,
      omitted: { by_cap: 0, by_baseline: 0, by_memory: 0 },
      analyses: [{
        capture: {
          url: "http://x",
          viewport: { name: "desktop", width: 1000, height: 800 },
          screenshot: Buffer.from("fakepng"),
          fullPage: false,
          timestamp: "t",
          dom: DOM,
        },
        analysis: analysis([issue({ element_ref: "E1", element_rect: { x: 100, y: 50, w: 200, h: 40 } })]),
      }],
    };
    const html = renderReviewHtmlReport(report);
    assert.doesNotMatch(html, /class="anno /);
  });
});

describe("end-to-end annotation with the mock provider", () => {
  it("captures dom, cites E1, and resolves its rect", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ml-anno-"));
    try {
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
      });

      const entry = result.report.analyses[0];
      assert.ok(entry.capture.dom, "capture carries a dom snapshot");
      assert.ok(entry.capture.dom!.elements.length > 0, "snapshot found elements");
      assert.ok(entry.capture.dom!.page.height > 0);
      const cited = entry.analysis.issues.find((i) => i.element_ref === "E1");
      assert.ok(cited, "mock cited E1");
      assert.ok(cited!.element_rect, "rect resolved");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
