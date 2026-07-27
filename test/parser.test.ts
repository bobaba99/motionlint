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

describe("parseAnalysisResponse — fenced payloads containing nested fences", () => {
  // Regression: a verbose model writes a code snippet inside the `fix` string and
  // wraps the whole answer in a ```json fence. The non-greedy fence regex used to
  // stop at the INNER fence, truncating the JSON mid-string; the review was then
  // silently reported as 0/10 with no issues. Caught in the 2026-07-27 benchmark,
  // where it cost claude-opus-5 3 of 24 fixtures and claude-sonnet-5 1 of 24.
  const withNestedFence = (fixText: string) =>
    "```json\n" +
    JSON.stringify({
      overall_score: 7,
      summary: "Scroll reveal is fine.",
      issues: [{
        category: "interaction",
        severity: "warning",
        location: ".hero",
        issue: "Parallax uses top instead of transform",
        why_it_matters: "Layout thrash on every frame.",
        fix: fixText,
      }],
      strengths: [],
    }, null, 2) +
    "\n```";

  it("parses when the fix field embeds a fenced code block", () => {
    const raw = withNestedFence("Use transform:\n```css\n.hero { transform: translateY(var(--y)); }\n```\nnot top.");
    const out = parseAnalysisResponse(raw, "desktop");
    assert.equal(out.overall_score, 7);
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0].issue, "Parallax uses top instead of transform");
  });

  it("parses when the fix field embeds multiple fenced blocks", () => {
    const raw = withNestedFence("Before:\n```css\n.a{top:0}\n```\nAfter:\n```css\n.a{transform:none}\n```");
    const out = parseAnalysisResponse(raw, "desktop");
    assert.equal(out.issues.length, 1);
  });

  it("still surfaces genuinely malformed JSON rather than inventing a clean review", () => {
    const out = parseAnalysisResponse('```json\n{"overall_score": 7, "summary": "unterminated\n```', "desktop");
    assert.equal(out.issues.length, 0);
    assert.match(out.summary, /Failed to parse|did not return valid JSON/);
  });
});
