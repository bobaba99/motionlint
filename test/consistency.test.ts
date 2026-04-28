import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRuns } from "../src/providers/consistency.js";
import type { AnalysisResult, UXIssue } from "../src/types.js";

function issue(category: UXIssue["category"], severity: UXIssue["severity"], head: string, location = "x"): UXIssue {
  return { category, severity, location, issue: head, why_it_matters: "", fix: "" };
}

function analysis(issues: UXIssue[], score = 7, summary = ""): AnalysisResult {
  return { overall_score: score, summary, issues, strengths: [], viewport: "desktop" };
}

describe("self-consistency merge", () => {
  it("keeps issues that appear in >= threshold runs", () => {
    const a = analysis([issue("contrast", "warning", "low contrast on CTA")]);
    const b = analysis([issue("contrast", "warning", "low contrast on cta button")]);
    const c = analysis([issue("typography", "suggestion", "body too small")]);
    const merged = mergeRuns([a, b, c], 2, "desktop");
    assert.equal(merged.issues.length, 1);
    assert.equal(merged.issues[0].category, "contrast");
  });

  it("escalates severity to the maximum across votes", () => {
    const a = analysis([issue("contrast", "warning", "primary cta contrast")]);
    const b = analysis([issue("contrast", "critical", "primary cta contrast")]);
    const merged = mergeRuns([a, b], 2, "desktop");
    assert.equal(merged.issues[0].severity, "critical");
  });

  it("drops single-vote outliers when threshold = 2", () => {
    const a = analysis([issue("interaction", "warning", "weird flickering animation"), issue("typography", "warning", "body small")]);
    const b = analysis([issue("typography", "warning", "body small")]);
    const merged = mergeRuns([a, b], 2, "desktop");
    assert.equal(merged.issues.length, 1);
    assert.equal(merged.issues[0].category, "typography");
  });

  it("medianizes the overall_score and unions strengths", () => {
    const a: AnalysisResult = { overall_score: 5, summary: "short", issues: [], strengths: ["a"], viewport: "d" };
    const b: AnalysisResult = { overall_score: 8, summary: "longer summary text", issues: [], strengths: ["b"], viewport: "d" };
    const c: AnalysisResult = { overall_score: 9, summary: "", issues: [], strengths: ["a"], viewport: "d" };
    const merged = mergeRuns([a, b, c], 1, "d");
    assert.equal(merged.overall_score, 8);
    assert.equal(merged.summary, "longer summary text");
    assert.deepEqual(merged.strengths.sort(), ["a", "b"]);
  });
});
