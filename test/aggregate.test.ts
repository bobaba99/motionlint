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
});
