import { describe, it } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runEval } from "../src/eval/runner.js";
import { renderEvalReport } from "../src/eval/report.js";

/**
 * Side-effect "test" that produces a sample eval report so contributors can see
 * the format without running the real CLI. Output: eval/results/sample-mock-eval.md
 */
describe("sample eval report (mock provider)", () => {
  it("writes a sample tiered eval report to eval/results/sample-mock-eval.md", async () => {
    const report = await runEval({
      truthPath: resolve("eval/truth.json"),
      fixturesDir: resolve("eval/fixtures"),
      provider: "mock",
      onlyLevels: ["L1-basic"],
      stopOnFail: false,
    });

    const outDir = resolve("eval/results");
    await mkdir(outDir, { recursive: true });
    await writeFile(resolve(outDir, "sample-mock-eval.md"), renderEvalReport(report), "utf8");
    await writeFile(
      resolve(outDir, "sample-mock-eval.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
  });
});
