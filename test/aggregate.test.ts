import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/report/aggregate.js";
import type { AnalysisEntry } from "../src/types.js";

function entry(score: number, severities: Array<"critical" | "warning" | "suggestion">): AnalysisEntry {
  return {
    capture: {
      url: "http://x",
      viewport: { name: "desktop", width: 1440, height: 900 },
      screenshot: Buffer.from(""),
      fullPage: true,
      timestamp: new Date().toISOString(),
    },
    analysis: {
      overall_score: score,
      summary: "",
      issues: severities.map((s) => ({
        category: "spacing",
        severity: s,
        location: "x",
        issue: "x",
        why_it_matters: "",
        fix: "",
      })),
      strengths: [],
      viewport: "desktop",
    },
  };
}

describe("aggregate", () => {
  it("counts severities and averages scores", () => {
    const r = aggregate("u", "p", "m", [
      entry(8, ["critical", "warning", "suggestion"]),
      entry(6, ["warning", "warning"]),
    ]);
    assert.equal(r.critical_count, 1);
    assert.equal(r.warning_count, 3);
    assert.equal(r.suggestion_count, 1);
    assert.equal(r.aggregate_score, 7);
  });

  it("ignores zero-scored entries when averaging", () => {
    const r = aggregate("u", "p", "m", [entry(0, []), entry(8, [])]);
    assert.equal(r.aggregate_score, 8);
  });

  it("reports zero omitted counts when no cap is set", () => {
    const r = aggregate("u", "p", "m", [entry(8, ["critical", "warning"])]);
    assert.deepEqual(r.omitted, { by_cap: 0, by_baseline: 0, by_memory: 0 });
  });
});

describe("aggregate with maxFindings", () => {
  it("keeps the top N findings by severity across all viewports", () => {
    const r = aggregate(
      "u", "p", "m",
      [entry(8, ["suggestion", "warning"]), entry(6, ["critical", "warning"])],
      { maxFindings: 2 },
    );
    const kept = r.analyses.flatMap((e) => e.analysis.issues.map((i) => i.severity));
    assert.deepEqual(kept.sort(), ["critical", "warning"]);
    assert.equal(r.critical_count, 1);
    assert.equal(r.warning_count, 1);
    assert.equal(r.suggestion_count, 0);
    assert.equal(r.omitted.by_cap, 2);
  });

  it("breaks severity ties by original order (earlier viewport wins)", () => {
    const r = aggregate(
      "u", "p", "m",
      [entry(8, ["warning"]), entry(6, ["warning"])],
      { maxFindings: 1 },
    );
    assert.equal(r.analyses[0].analysis.issues.length, 1);
    assert.equal(r.analyses[1].analysis.issues.length, 0);
    assert.equal(r.omitted.by_cap, 1);
  });

  it("is a no-op when the cap exceeds the finding count", () => {
    const r = aggregate("u", "p", "m", [entry(8, ["critical", "warning"])], { maxFindings: 10 });
    assert.equal(r.analyses[0].analysis.issues.length, 2);
    assert.equal(r.omitted.by_cap, 0);
  });

  it("ignores non-positive or null caps", () => {
    for (const maxFindings of [null, 0, -3]) {
      const r = aggregate("u", "p", "m", [entry(8, ["critical", "warning"])], { maxFindings });
      assert.equal(r.analyses[0].analysis.issues.length, 2, `cap=${maxFindings}`);
      assert.equal(r.omitted.by_cap, 0, `cap=${maxFindings}`);
    }
  });

  it("does not mutate the input analyses", () => {
    const input = [entry(8, ["suggestion", "warning", "critical"])];
    aggregate("u", "p", "m", input, { maxFindings: 1 });
    assert.equal(input[0].analysis.issues.length, 3);
  });

  it("carries baseline/memory omission counts through to the report", () => {
    const r = aggregate("u", "p", "m", [entry(8, ["critical"])], {
      omitted: { by_baseline: 2, by_memory: 3 },
    });
    assert.deepEqual(r.omitted, { by_cap: 0, by_baseline: 2, by_memory: 3 });
  });
});
