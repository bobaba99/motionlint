import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAnalysisResponse } from "../src/analysis/parser.js";

const SAMPLE = `{
  "overall_score": 8,
  "summary": "Clean hero, busy footer.",
  "issues": [
    { "category": "spacing", "severity": "warning", "location": "footer", "issue": "Tight padding", "why_it_matters": "Looks cramped", "fix": "Add 24px padding" }
  ],
  "strengths": ["Hero hierarchy is strong"],
  "viewport": "desktop"
}`;

describe("parseAnalysisResponse", () => {
  it("parses well-formed JSON", () => {
    const out = parseAnalysisResponse(SAMPLE, "desktop");
    assert.equal(out.overall_score, 8);
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0].severity, "warning");
    assert.equal(out.viewport, "desktop");
  });

  it("extracts JSON from fenced markdown", () => {
    const fenced = "Here you go:\n```json\n" + SAMPLE + "\n```";
    const out = parseAnalysisResponse(fenced, "mobile");
    assert.equal(out.overall_score, 8);
    assert.equal(out.issues.length, 1);
  });

  it("returns a graceful fallback on garbage input", () => {
    const out = parseAnalysisResponse("not json at all", "tablet");
    assert.equal(out.overall_score, 0);
    assert.equal(out.viewport, "tablet");
    assert.equal(out.issues.length, 0);
  });

  it("filters issues with invalid category or severity", () => {
    const bad = JSON.stringify({
      overall_score: 5,
      summary: "x",
      issues: [
        { category: "spacing", severity: "warning", location: "x", issue: "ok", why_it_matters: "", fix: "" },
        { category: "made-up", severity: "warning", location: "x", issue: "skipme", why_it_matters: "", fix: "" },
        { category: "spacing", severity: "yelling", location: "x", issue: "skipme", why_it_matters: "", fix: "" },
      ],
      strengths: [],
      viewport: "desktop",
    });
    const out = parseAnalysisResponse(bad, "desktop");
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0].issue, "ok");
  });

  it("clamps overall_score to [0,10]", () => {
    const out = parseAnalysisResponse('{"overall_score": 42, "summary":"", "issues":[], "strengths":[], "viewport":"d"}', "d");
    assert.equal(out.overall_score, 10);
  });
});
