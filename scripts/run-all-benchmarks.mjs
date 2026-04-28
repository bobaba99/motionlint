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

// (provider, model) pairs to benchmark. Latest of each as of 2026-04-27.
const RUNS = [
  { provider: "anthropic", model: "claude-sonnet-4-6",        env: "ANTHROPIC_API_KEY" },
  { provider: "openai",    model: "gpt-5.5",                  env: "OPENAI_API_KEY" },
  { provider: "google",    model: "gemini-3.1-pro-preview",   env: "GOOGLE_API_KEY" },
  { provider: "ollama",    model: "gemma3:4b",                env: null, requiresOllama: true },
];

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

const results = await Promise.all(RUNS.map(runOne));

const aggregate = { generated_at: new Date().toISOString(), runs: results };
await writeFile(join(OUT_DIR, "AGGREGATE.json"), JSON.stringify(aggregate, null, 2), "utf8");

console.error(`\n=== AGGREGATE ===`);
console.error(JSON.stringify(aggregate.runs, null, 2));
console.error(`\nWrote ${OUT_DIR}/AGGREGATE.json + per-provider SCORECARD-*.md / report-*.json`);
