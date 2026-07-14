import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRun,
  detectRegressions,
  emptyHistory,
  loadHistory,
  previousRun,
  recordFromReport,
  saveHistory,
  type EvalRunRecord,
} from "../src/eval/history.js";
import { actionLine, buildAddenda, loadAddendaForPrompt, renderAddendaFile, saveAddenda } from "../src/eval/evolve.js";
import { buildPrompt } from "../src/analysis/prompt.js";
import type { EvalReport, NextAction } from "../src/eval/types.js";

function record(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    timestamp: "2026-07-14T00:00:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-5",
    levels: { "L1-basic": { recall: 0.9, control_violations: 0, passing: true } },
    aggregate_recall: 0.9,
    overall_passing: true,
    next_actions: 1,
    ...overrides,
  };
}

describe("eval history", () => {
  it("appends immutably and caps at 100 runs", () => {
    let history = emptyHistory();
    for (let i = 0; i < 105; i++) history = appendRun(history, record({ timestamp: `t${i}` }));
    assert.equal(history.runs.length, 100);
    assert.equal(history.runs[0].timestamp, "t5");
    assert.equal(history.runs.at(-1)!.timestamp, "t104");
  });

  it("finds the previous run of the same provider+model only", () => {
    let history = emptyHistory();
    history = appendRun(history, record({ provider: "openai", timestamp: "a" }));
    history = appendRun(history, record({ timestamp: "b" }));
    history = appendRun(history, record({ provider: "openai", timestamp: "c" }));
    assert.equal(previousRun(history, record())?.timestamp, "b");
  });

  it("flags recall drops and newly failing levels, ignores improvements", () => {
    let history = emptyHistory();
    history = appendRun(history, record());
    const worse = record({
      timestamp: "later",
      aggregate_recall: 0.7,
      levels: { "L1-basic": { recall: 0.7, control_violations: 1, passing: false } },
    });
    const regressions = detectRegressions(history, worse);
    assert.equal(regressions.length, 2);
    assert.match(regressions[0], /aggregate recall dropped 90\.0% → 70\.0%/);
    assert.match(regressions[1], /L1-basic newly failing/);

    const better = record({ aggregate_recall: 0.95 });
    assert.deepEqual(detectRegressions(history, better), []);
  });

  it("returns no regressions without a same-config baseline", () => {
    let history = emptyHistory();
    history = appendRun(history, record({ provider: "openai" }));
    assert.deepEqual(detectRegressions(history, record()), []);
  });

  it("round-trips through disk and tolerates a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ml-hist-"));
    try {
      const path = join(dir, "history.json");
      assert.deepEqual(await loadHistory(path), emptyHistory());
      await saveHistory(path, appendRun(emptyHistory(), record()));
      const loaded = await loadHistory(path);
      assert.equal(loaded.runs.length, 1);
      assert.equal(loaded.runs[0].provider, "anthropic");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds a record from an eval report", () => {
    const report = {
      generated_at: "now",
      provider: "mock",
      model: "m",
      levels: [
        { level: "L1", recall: 1, control_violations: 0, passing: true, total_expected: 4, total_detected: 4 },
        { level: "L2", recall: 0.5, control_violations: 1, passing: false, total_expected: 4, total_detected: 2 },
      ],
      overall_passing: false,
      next_actions: [{}, {}],
    } as unknown as EvalReport;
    const rec = recordFromReport(report);
    assert.equal(rec.aggregate_recall, 0.75);
    assert.equal(rec.levels["L2"].passing, false);
    assert.equal(rec.next_actions, 2);
  });
});

describe("prompt evolution", () => {
  const action: NextAction = {
    level: "L2",
    fixture: "skeleton",
    category: "loading_state",
    severity: "critical",
    description: "Missed absent loading feedback after submit.",
    expected_signal: "no spinner within 300ms of click",
    suggested_fix: "Add a skeleton or progress indicator.",
  };

  it("formats, dedupes against existing lines, and caps", () => {
    const line = actionLine(action);
    assert.match(line, /Watch for loading_state \(critical\)/);
    const merged = buildAddenda([action], [line, "- Watch for contrast (warning): old one [L1/hero · contrast]"]);
    assert.equal(merged.length, 2, "same fixture/category dedupes");
    const many = buildAddenda(
      Array.from({ length: 20 }, (_, i) => ({ ...action, fixture: `f${i}` })),
      [],
    );
    assert.equal(many.length, 12, "capped at 12");
  });

  it("round-trips the addenda file and feeds the prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ml-evolve-"));
    try {
      const path = join(dir, "addenda.md");
      await saveAddenda(path, buildAddenda([action]));
      const learned = await loadAddendaForPrompt(path);
      assert.ok(learned);
      const prompt = await buildPrompt({ viewportName: "desktop", learned });
      assert.match(prompt, /## Learned heuristics/);
      assert.match(prompt, /loading_state \(critical\)/);
      assert.equal(await loadAddendaForPrompt(join(dir, "missing.md")), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders a file with the auto-generated marker", () => {
    const text = renderAddendaFile(["- a line [L1/x · contrast]"]);
    assert.match(text, /auto-generated by `motionlint eval --evolve`/);
  });
});
