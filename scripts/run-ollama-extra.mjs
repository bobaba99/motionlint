// Run the animation stress test against extra local Ollama models in
// PARALLEL (different models on the same Ollama instance — Ollama 0.22+
// loads multiple models concurrently when memory allows), then merge the
// results into the existing AGGREGATE.json so the README's scorecard
// table can be regenerated without re-running cloud providers.
//
// Cost: $0 — local only. Wall time ≈ max(per-model) on machines with
// enough unified memory (the small model finishes "for free" alongside).

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const { loadEnv } = await import("../dist/config/env.js");
loadEnv();

const { runStress, renderStressMarkdown } = await import("../dist/flow/stress.js");

const RUNS = [
  { provider: "ollama", model: "glm-ocr" },
  { provider: "ollama", model: "nemotron3:33b" },
];

const OUT_DIR = resolve(".motionlint/stress");
const AGG_PATH = join(OUT_DIR, "AGGREGATE.json");
await mkdir(OUT_DIR, { recursive: true });

// Verify Ollama is reachable up-front so we fail fast if it's not.
try {
  const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error("not ok");
} catch {
  console.error("❌ Ollama not reachable on http://localhost:11434");
  process.exit(1);
}

async function runOne(run) {
  const tag = `${run.provider}-${run.model.replace(/[^a-z0-9]/gi, "-")}`;
  console.error(`\n▶ START ${run.provider} (${run.model})`);
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
        if (e.index === 1 || e.index === e.total || e.index % 4 === 0) {
          console.error(`  [${run.model} ${e.index}/${e.total}] ${e.pattern} ${e.variant}`);
        }
      },
    });
  } catch (err) {
    console.error(`  ❌ ${run.model} failed: ${err.message}`);
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
  console.error(`✅ DONE  ${run.model}: recall=${(summary.broken_recall * 100).toFixed(0)}%, FPR=${(summary.good_false_positive_rate * 100).toFixed(0)}%, gap=${summary.avg_score_gap.toFixed(1)}, ${summary.elapsed_seconds}s`);
  return summary;
}

// Parallel — different models on Ollama 0.22+ load concurrently when memory
// allows. The small model finishes well before the big one, so wall time
// effectively collapses to the slower model's runtime.
const newRuns = await Promise.all(RUNS.map(runOne));

// Merge into existing AGGREGATE.json — replace any existing rows for the same
// (provider, model), append otherwise.
let agg = { generated_at: new Date().toISOString(), runs: [] };
try {
  agg = JSON.parse(await readFile(AGG_PATH, "utf8"));
} catch { /* fresh */ }

for (const newRow of newRuns) {
  const idx = agg.runs.findIndex((r) => r.provider === newRow.provider && r.model === newRow.model);
  if (idx >= 0) agg.runs[idx] = newRow;
  else agg.runs.push(newRow);
}
agg.generated_at = new Date().toISOString();

await writeFile(AGG_PATH, JSON.stringify(agg, null, 2), "utf8");

console.error(`\n=== AGGREGATE (merged) ===`);
console.error(JSON.stringify(agg.runs, null, 2));
console.error(`\nWrote ${OUT_DIR}/AGGREGATE.json (merged) + per-model SCORECARD-*.md / report-*.json`);
