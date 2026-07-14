import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addUsage,
  budgetExhausted,
  emptyRunUsage,
  formatUsageLine,
  usageFromAnthropic,
  usageFromGoogle,
  usageFromOllama,
  usageFromOpenAI,
} from "../src/resources/usage.js";
import { mergeRuns } from "../src/providers/consistency.js";
import { runReview } from "../src/pipeline.js";
import { defaultConfig } from "../src/config/loader.js";
import type { AnalysisResult } from "../src/types.js";

describe("provider usage normalization", () => {
  it("maps Anthropic usage fields", () => {
    assert.deepEqual(usageFromAnthropic({ usage: { input_tokens: 1200, output_tokens: 300 } }), {
      input_tokens: 1200,
      output_tokens: 300,
      total_tokens: 1500,
    });
  });

  it("maps OpenAI usage fields", () => {
    assert.deepEqual(usageFromOpenAI({ usage: { prompt_tokens: 900, completion_tokens: 100 } }), {
      input_tokens: 900,
      output_tokens: 100,
      total_tokens: 1000,
    });
  });

  it("maps Google usageMetadata fields", () => {
    assert.deepEqual(usageFromGoogle({ usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 50 } }), {
      input_tokens: 700,
      output_tokens: 50,
      total_tokens: 750,
    });
  });

  it("maps Ollama eval counts", () => {
    assert.deepEqual(usageFromOllama({ prompt_eval_count: 640, eval_count: 128 }), {
      input_tokens: 640,
      output_tokens: 128,
      total_tokens: 768,
    });
  });

  it("returns undefined for missing or malformed usage blocks", () => {
    assert.equal(usageFromAnthropic({}), undefined);
    assert.equal(usageFromOpenAI({ usage: { prompt_tokens: "nope" } }), undefined);
    assert.equal(usageFromGoogle(null), undefined);
    assert.equal(usageFromOllama({ prompt_eval_count: -5 }), undefined);
  });
});

describe("run usage accounting", () => {
  it("accumulates calls and totals, counting usage-less calls too", () => {
    let run = emptyRunUsage(null);
    run = addUsage(run, { input_tokens: 100, output_tokens: 10, total_tokens: 110 });
    run = addUsage(run, undefined);
    run = addUsage(run, { input_tokens: 50, output_tokens: 5, total_tokens: 55 });
    assert.equal(run.calls, 3);
    assert.equal(run.total_tokens, 165);
  });

  it("reports exhaustion only at or past the limit", () => {
    let run = emptyRunUsage(200);
    assert.equal(budgetExhausted(run), false);
    run = addUsage(run, { input_tokens: 150, output_tokens: 49, total_tokens: 199 });
    assert.equal(budgetExhausted(run), false);
    run = addUsage(run, { input_tokens: 0, output_tokens: 1, total_tokens: 1 });
    assert.equal(budgetExhausted(run), true);
    assert.equal(budgetExhausted({ ...run, limit: null }), false, "no limit, never exhausted");
  });

  it("formats the terminal/report line", () => {
    const line = formatUsageLine({
      input_tokens: 2000, output_tokens: 500, total_tokens: 2500,
      calls: 2, limit: 2400, skipped_viewports: ["desktop"],
    });
    assert.match(line, /2,000 in \/ 500 out/);
    assert.match(line, /budget 2,400/);
    assert.match(line, /skipped: desktop/);
  });
});

describe("self-consistency usage merge", () => {
  function result(tokens: number | null): AnalysisResult {
    return {
      overall_score: 7,
      summary: "s",
      issues: [],
      strengths: [],
      viewport: "mobile",
      ...(tokens === null ? {} : { usage: { input_tokens: tokens, output_tokens: 0, total_tokens: tokens } }),
    };
  }

  it("sums usage across samples", () => {
    const merged = mergeRuns([result(100), result(250)], 1, "mobile");
    assert.deepEqual(merged.usage, { input_tokens: 350, output_tokens: 0, total_tokens: 350 });
  });

  it("omits usage when no sample reported any", () => {
    const merged = mergeRuns([result(null), result(null)], 1, "mobile");
    assert.equal(merged.usage, undefined);
  });
});

describe("pipeline budget enforcement (mock provider)", () => {
  let dir: string;
  after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("skips remaining viewports once the budget is exhausted and reports usage", async () => {
    dir = await mkdtemp(join(tmpdir(), "ml-usage-"));
    const config = structuredClone(defaultConfig);
    config.screenshotDir = join(dir, "shots");
    config.videoDir = join(dir, "videos");
    config.reportDir = join(dir, "reports");
    config.memory.enabled = false;

    // Mock emits 1,250 tokens per call; a 1,000-token budget is exhausted after call 1.
    const result = await runReview({
      url: "http://localhost:4173/",
      config,
      provider: "mock",
      viewports: ["mobile", "desktop"],
      outputPath: null,
      maxTokens: 1000,
    });

    const usage = result.report.usage;
    assert.ok(usage, "report carries usage");
    assert.equal(usage!.calls, 1);
    assert.equal(usage!.total_tokens, 1250);
    assert.equal(usage!.limit, 1000);
    assert.deepEqual(usage!.skipped_viewports, ["desktop"]);
    assert.equal(result.report.analyses.length, 1, "only the first viewport was analyzed");
  });

  it("analyzes everything and reports totals when no budget is set", async () => {
    const config = structuredClone(defaultConfig);
    config.screenshotDir = join(dir, "shots2");
    config.videoDir = join(dir, "videos2");
    config.reportDir = join(dir, "reports2");
    config.memory.enabled = false;

    const result = await runReview({
      url: "http://localhost:4173/",
      config,
      provider: "mock",
      viewports: ["mobile", "desktop"],
      outputPath: null,
    });

    const usage = result.report.usage;
    assert.ok(usage);
    assert.equal(usage!.calls, 2);
    assert.equal(usage!.total_tokens, 2500);
    assert.equal(usage!.limit, null);
    assert.deepEqual(usage!.skipped_viewports, []);
  });
});
