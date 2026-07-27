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

describe("self-consistency degrades honestly when samples fail", () => {
  // The threshold was derived from the number of samples ATTEMPTED, but only
  // successful samples cast votes. With `--consistency 3` (threshold 2), two
  // failed samples meant the surviving run's findings each held 1 vote and were
  // all dropped — while the median score, which already excluded score-0 runs,
  // came from the good run. The result was a confident "8/10, no issues": the
  // good run's score wearing the failed runs' emptiness.
  //
  // This is the most dangerous shape in the codebase, because it is the mode a
  // user opted into and paid 3x for precisely to get MORE confidence.
  const crit = issue("contrast", "critical", "CTA text fails AA on the hero");

  it("does not let failed samples veto findings from the surviving sample", () => {
    const good = analysis([crit], 8);
    const failed = analysis([], 0, "Failed to parse model JSON");
    // Threshold is clamped to the number of usable runs, so the lone good run
    // is enough. Previously: threshold 2 vs 1 vote -> issue silently dropped.
    const merged = mergeRuns([good, failed, failed], 2, "desktop");
    assert.equal(merged.issues.length, 1, "surviving sample's critical finding must not be dropped");
    assert.equal(merged.issues[0].severity, "critical");
  });

  it("clamps an over-large threshold to the run count rather than dropping everything", () => {
    const merged = mergeRuns([analysis([crit], 8)], 3, "desktop");
    assert.equal(merged.issues.length, 1);
  });

  it("still filters findings that only one of several healthy runs reported", () => {
    const a = analysis([crit], 8);
    const b = analysis([issue("spacing", "warning", "gap too tight")], 7);
    const c = analysis([issue("spacing", "warning", "gap too tight")], 7);
    const merged = mergeRuns([a, b, c], 2, "desktop");
    assert.equal(merged.issues.length, 1);
    assert.equal(merged.issues[0].category, "spacing");
  });
});
