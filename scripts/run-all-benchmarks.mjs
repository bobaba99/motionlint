// Run the animation stress test against every available provider in turn,
// save a per-provider scorecard, and emit an aggregate JSON for the README.
//
// Cost: ~24 calls × N providers. Anthropic / OpenAI ≈ $0.005 each, Google ≈
// $0.001, Ollama free.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const { loadEnv } = await import("../dist/config/env.js");
loadEnv();

const { runStress, renderStressMarkdown } = await import("../dist/flow/stress.js");

// (provider, model) pairs to benchmark. Latest of each as of 2026-07-27.
// gpt-5.5 is kept for continuity with the 2026-04-29 table — it was that run's
// only 100%-recall / 0%-FPR model, so it doubles as the control that tells us how
// much of any delta comes from the model versus the flow-prompt change in cc1104d.
const RUNS = [
  { provider: "anthropic", model: "claude-opus-5",    env: "ANTHROPIC_API_KEY" },
  { provider: "anthropic", model: "claude-sonnet-5",  env: "ANTHROPIC_API_KEY" },
  { provider: "openai",    model: "gpt-5.6-sol",      env: "OPENAI_API_KEY" },
  { provider: "openai",    model: "gpt-5.5",          env: "OPENAI_API_KEY" },
  { provider: "google",    model: "gemini-3.6-flash", env: "GOOGLE_API_KEY" },
];

// `--only <substring>` (repeatable) narrows the lineup, so a single model can be
// re-run without redoing the whole table. Matches against "provider:model".
const onlyFilters = process.argv.reduce((acc, arg, i) => {
  if (arg === "--only" && process.argv[i + 1]) acc.push(process.argv[i + 1].toLowerCase());
  return acc;
}, []);
const SELECTED = onlyFilters.length
  ? RUNS.filter((r) => onlyFilters.some((f) => `${r.provider}:${r.model}`.toLowerCase().includes(f)))
  : RUNS;

if (!SELECTED.length) {
  console.error(`No runs matched --only ${onlyFilters.join(", ")}`);
  console.error(`Available: ${RUNS.map((r) => `${r.provider}:${r.model}`).join(", ")}`);
  process.exit(1);
}

const OUT_DIR = resolve(".motionlint/stress");
await mkdir(OUT_DIR, { recursive: true });

// Run all four providers in parallel. Each spawns its own Playwright sessions
// and hits its own API; rate limits are per-provider so concurrency = 4 here
// is safe. Wall-time ≈ max(per-provider) instead of sum(per-provider).
async function runOne(run) {
  const tag = `${run.provider}-${run.model.replace(/[^a-z0-9]/gi, "-")}`;
  if (run.env && !process.env[run.env]) {
    return { provider: run.provider, model: run.model, skipped: true, reason: `${run.env} not set` };
  }
  if (run.requiresOllama) {
    try {
      const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error("not ok");
    } catch {
      return { provider: run.provider, model: run.model, skipped: true, reason: "Ollama not reachable" };
    }
  }

  console.error(`▶ START ${run.provider} (${run.model})`);
  const t0 = Date.now();
  let report;
  try {
    report = await runStress({
      stressPath: resolve("eval/animation-stress.json"),
      fixturesDir: resolve("eval/animation-fixtures"),
      artifactDir: join(OUT_DIR, tag),
      provider: run.provider,
      model: run.model,
      consistency: 1,
      onProgress: (e) => {
        // Avoid intermixed \r per-line spam; just announce milestones.
        if (e.index === 1 || e.index === e.total || e.index % 6 === 0) {
          console.error(`  [${run.provider} ${e.index}/${e.total}] ${e.pattern} ${e.variant}`);
        }
      },
    });
  } catch (err) {
    console.error(`  ❌ ${run.provider} failed: ${err.message}`);
    return { provider: run.provider, model: run.model, error: err.message };
  }

  const elapsedMs = Date.now() - t0;
  await writeFile(join(OUT_DIR, `SCORECARD-${tag}.md`), renderStressMarkdown(report), "utf8");
  await writeFile(join(OUT_DIR, `report-${tag}.json`), JSON.stringify(report, null, 2), "utf8");

  const summary = {
    provider: run.provider,
    model: run.model,
    broken_recall: report.broken_recall,
    good_false_positive_rate: report.good_false_positive_rate,
    avg_score_gap: report.avg_score_gap,
    elapsed_seconds: Math.round(elapsedMs / 1000),
  };
  console.error(`✅ DONE  ${run.provider}: recall=${(summary.broken_recall * 100).toFixed(0)}%, FPR=${(summary.good_false_positive_rate * 100).toFixed(0)}%, gap=${summary.avg_score_gap.toFixed(1)}, ${summary.elapsed_seconds}s`);
  return summary;
}

const results = await Promise.all(SELECTED.map(runOne));

// A filtered run must not clobber the full table; write a scoped aggregate instead
// and let the caller merge.
const aggregateName = onlyFilters.length
  ? `AGGREGATE-${onlyFilters.join("_").replace(/[^a-z0-9]+/gi, "-")}.json`
  : "AGGREGATE.json";
const aggregate = { generated_at: new Date().toISOString(), runs: results };
await writeFile(join(OUT_DIR, aggregateName), JSON.stringify(aggregate, null, 2), "utf8");

console.error(`\n=== AGGREGATE ===`);
console.error(JSON.stringify(aggregate.runs, null, 2));
console.error(`\nWrote ${join(OUT_DIR, aggregateName)} + per-provider SCORECARD-*.md / report-*.json`);
