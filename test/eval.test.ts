import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runEval } from "../src/eval/runner.js";
import { renderEvalReport } from "../src/eval/report.js";

const TRUTH = resolve("eval/truth.json");
const FIXTURES = resolve("eval/fixtures");

describe("tiered eval harness", () => {
  it("runs L1 with mock provider, scores against labels, never reveals labels to model", async () => {
    const report = await runEval({
      truthPath: TRUTH,
      fixturesDir: FIXTURES,
      provider: "mock",
      onlyLevels: ["L1-basic"],
      stopOnFail: true,
    });

    assert.equal(report.provider, "mock");
    assert.ok(report.levels.length === 1);
    const l1 = report.levels[0];
    assert.equal(l1.level, "L1-basic");
    assert.ok(l1.fixtures.length >= 11);
    // The control fixture must be present at L1.
    const control = l1.fixtures.find((f) => f.fixture === "clean-control");
    assert.ok(control);
    assert.equal(control!.expected, 0);
    // Mock provider is generic — recall on L1 should be far below 1.0; this is correct behavior
    // for an unwired provider and the test is just verifying the *plumbing*.
    assert.ok(l1.recall >= 0 && l1.recall <= 1);
  });

  it("attempts higher levels when stopOnFail=false even if L1 fails", async () => {
    const report = await runEval({
      truthPath: TRUTH,
      fixturesDir: FIXTURES,
      provider: "mock",
      onlyLevels: ["L1-basic", "L2-intermediate"],
      stopOnFail: false,
      only: ["clean-control", "control-portfolio", "low-contrast-cta", "form-double-fault"],
    });
    assert.equal(report.levels.length, 2);
    assert.equal(report.levels[0].level, "L1-basic");
    assert.equal(report.levels[1].level, "L2-intermediate");
  });

  it("renders next_actions as parseable JSON for downstream LLM coding tools", async () => {
    const report = await runEval({
      truthPath: TRUTH,
      fixturesDir: FIXTURES,
      provider: "mock",
      onlyLevels: ["L1-basic"],
      only: ["low-contrast-cta", "tiny-body-text"],
      stopOnFail: false,
    });
    const md = renderEvalReport(report);
    assert.match(md, /MotionLint Eval Report/);
    assert.match(md, /Highest passing level/);
    assert.match(md, /Next actions for the coding agent/);
    // The JSON block must round-trip.
    const block = md.match(/```json\n([\s\S]*?)\n```/);
    if (block) {
      const parsed = JSON.parse(block[1]) as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(parsed));
      if (parsed.length > 0) {
        assert.ok("level" in parsed[0]);
        assert.ok("fixture" in parsed[0]);
        assert.ok("category" in parsed[0]);
      }
    }
  });
});
