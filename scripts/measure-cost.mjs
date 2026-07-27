// Measure REAL per-review token usage for each model against the demo app, so the
// README cost column is measured rather than modeled. One `motionlint review` at
// default settings (2 viewports, full-page) per model.
const ROOT = "/Users/zihaogeng/development/motionlint";
const { loadEnv } = await import(`${ROOT}/dist/config/env.js`);
loadEnv(ROOT);
const { runReview } = await import(`${ROOT}/dist/pipeline.js`);
const { loadConfig } = await import(`${ROOT}/dist/config/loader.js`);
const config = await loadConfig(ROOT);

// Published list prices, USD per million tokens (verified July 2026).
const PRICES = {
  "claude-opus-5":    { in: 5.00, out: 25.00 },
  "claude-sonnet-5":  { in: 2.00, out: 10.00 },  // introductory, through 2026-08-31
  "gpt-5.6-sol":      { in: 5.00, out: 30.00 },
  "gpt-5.5":          { in: 5.00, out: 30.00 },
  "gemini-3.6-flash": { in: 1.50, out: 7.50 },
};

const RUNS = [
  { provider: "anthropic", model: "claude-opus-5" },
  { provider: "anthropic", model: "claude-sonnet-5" },
  { provider: "openai",    model: "gpt-5.6-sol" },
  { provider: "openai",    model: "gpt-5.5" },
  { provider: "google",    model: "gemini-3.6-flash" },
];

const out = [];
await Promise.all(RUNS.map(async (r) => {
  try {
    const report = await runReview({
      url: "http://localhost:4173/cat",
      config,
      provider: r.provider,
      model: r.model,
      format: "json",
      outputPath: null,
    });
    const u = report.report?.usage;
    if (!u) { out.push({ ...r, error: "no usage reported" }); return; }
    const p = PRICES[r.model];
    const cost = (u.input_tokens / 1e6) * p.in + (u.output_tokens / 1e6) * p.out;
    out.push({ ...r, in: u.input_tokens, out: u.output_tokens, calls: u.calls, cost });
  } catch (e) {
    out.push({ ...r, error: String(e.message).slice(0, 120) });
  }
}));

out.sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99));
console.log("\n| Model | Input tok | Output tok | Calls | Cost/review |");
console.log("| --- | --- | --- | --- | --- |");
for (const r of out) {
  if (r.error) { console.log(`| ${r.model} | — | — | — | ERROR: ${r.error} |`); continue; }
  console.log(`| ${r.model} | ${r.in.toLocaleString()} | ${r.out.toLocaleString()} | ${r.calls} | $${r.cost.toFixed(4)} |`);
}
import { writeFile } from "node:fs/promises";
await writeFile(`${ROOT}/.motionlint/cost/MEASURED.json`, JSON.stringify({ measured_at_utc_note: "see git log", runs: out }, null, 2));
