import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderSarifReport } from "../src/report/sarif.js";
import { aggregate } from "../src/report/aggregate.js";
import { runReview } from "../src/pipeline.js";
import { defaultConfig } from "../src/config/loader.js";
import type { AnalysisEntry, IssueSeverity, MotionLintConfig, ReviewReport } from "../src/types.js";

function entry(severities: IssueSeverity[], viewport = "desktop"): AnalysisEntry {
  return {
    capture: {
      url: "http://x",
      viewport: { name: viewport, width: 1440, height: 900 },
      screenshot: Buffer.from(""),
      fullPage: true,
      timestamp: new Date().toISOString(),
    },
    analysis: {
      overall_score: 7,
      summary: "",
      issues: severities.map((s, i) => ({
        category: "spacing",
        severity: s,
        location: `${viewport} location ${i}`,
        issue: "x",
        why_it_matters: "",
        fix: "",
      })),
      strengths: [],
      viewport,
    },
  };
}

function report(entries: AnalysisEntry[]): ReviewReport {
  return aggregate("http://x", "mock", "m", entries);
}

function parseResults(sarif: string): Array<{ level: string; properties: Record<string, unknown> }> {
  return JSON.parse(sarif).runs[0].results;
}

describe("renderSarifReport PR-surface cap", () => {
  it("caps annotations to N, keeping the most severe findings", () => {
    const sarif = renderSarifReport(
      report([entry(["suggestion", "warning"]), entry(["critical", "warning"], "mobile")]),
      { maxAnnotations: 2 },
    );
    const levels = parseResults(sarif).map((r) => r.level);
    assert.deepEqual(levels.sort(), ["error", "warning"]);
  });

  it("breaks severity ties by original order and preserves emission order", () => {
    const sarif = renderSarifReport(
      report([entry(["warning", "warning"]), entry(["warning"], "mobile")]),
      { maxAnnotations: 2 },
    );
    const results = parseResults(sarif);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.properties.viewport),
      ["desktop", "desktop"],
      "earlier entries win severity ties, in original order",
    );
  });

  it("records the omitted count in run properties when capped", () => {
    const sarif = renderSarifReport(
      report([entry(["critical", "warning", "suggestion"])]),
      { maxAnnotations: 1 },
    );
    const run = JSON.parse(sarif).runs[0];
    assert.equal(run.results.length, 1);
    assert.equal(run.properties.omitted_by_pr_cap, 2);
  });

  it("omits the property entirely when nothing was dropped", () => {
    const sarif = renderSarifReport(report([entry(["critical"])]), { maxAnnotations: 5 });
    const run = JSON.parse(sarif).runs[0];
    assert.equal("omitted_by_pr_cap" in run.properties, false);
  });

  it("ignores non-positive, null, or missing caps", () => {
    const r = report([entry(["critical", "warning", "suggestion"])]);
    for (const maxAnnotations of [undefined, null, 0, -3]) {
      const sarif = renderSarifReport(r, { maxAnnotations });
      assert.equal(parseResults(sarif).length, 3, `cap=${maxAnnotations}`);
    }
    assert.equal(parseResults(renderSarifReport(r)).length, 3, "no opts argument");
  });
});

describe("pipeline PR-surface cap wiring (requires demo server on :4173)", () => {
  const scratchDirs: string[] = [];
  after(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
  });

  async function sarifConfig(maxPrAnnotations: number | null): Promise<MotionLintConfig> {
    await mkdir(resolve(".motionlint/test-samples"), { recursive: true });
    const dir = await mkdtemp(resolve(".motionlint/test-samples/sarif-"));
    scratchDirs.push(dir);
    return {
      ...defaultConfig,
      defaultViewports: ["desktop"],
      screenshotDir: join(dir, "screenshots"),
      videoDir: join(dir, "videos"),
      reportDir: join(dir, "reports"),
      maxPrAnnotations,
      memory: { ...defaultConfig.memory, enabled: false },
    };
  }

  it("applies config.maxPrAnnotations to sarif output; per-call override wins", async () => {
    const config = await sarifConfig(1);
    const capped = await runReview({
      url: "http://localhost:4173",
      config,
      provider: "mock",
      format: "sarif",
      outputPath: null,
    });
    // Mock provider reports 3 issues per viewport.
    assert.equal(JSON.parse(capped.rendered).runs[0].results.length, 1);
    assert.equal(JSON.parse(capped.rendered).runs[0].properties.omitted_by_pr_cap, 2);

    const overridden = await runReview({
      url: "http://localhost:4173",
      config,
      provider: "mock",
      format: "sarif",
      outputPath: null,
      maxPrAnnotations: null,
    });
    assert.equal(JSON.parse(overridden.rendered).runs[0].results.length, 3);
  });
});
