import { Command } from "commander";
import kleur from "kleur";
import { readFile } from "node:fs/promises";
import { runReview } from "../pipeline.js";
import { loadConfig } from "../config/loader.js";
import { parseInteractionsFromString } from "../capture/interactions.js";
import { summarize } from "./output.js";
import type { OutputFormat, IssueSeverity } from "../types.js";

const VALID_FORMATS: ReadonlyArray<OutputFormat> = ["md", "json", "sarif"];
const VALID_SEVERITIES: ReadonlyArray<IssueSeverity> = ["critical", "warning", "suggestion"];

function fail(message: string): never {
  console.error(kleur.red(`✗ ${message}`));
  process.exit(2);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("motionlint")
    .description("AI design review in your terminal — automated UI/UX analysis using vision LLMs.")
    .version("0.1.0");

  program
    .command("review <url>")
    .description("Capture a URL at multiple viewports and analyze it for UX issues.")
    .option("-r, --routes <list>", "Comma-separated additional paths to also review (joined to base URL).")
    .option("-v, --viewport <name>", "Single viewport (mobile|tablet|desktop). Repeatable: -v mobile -v desktop.", collectViewport, [] as string[])
    .option("--viewports <list>", "Comma-separated viewport names.")
    .option("--provider <name>", "Provider: auto|ollama|anthropic|openai|google|mock.")
    .option("--model <name>", "Specific model id (e.g. gpt-4o, llava:13b).")
    .option("--rules <path>", "Path to a markdown file with project-specific design heuristics.")
    .option("--format <fmt>", `Output format: ${VALID_FORMATS.join("|")}.`, "md")
    .option("-o, --output <path>", "Write report to this file instead of the default reportDir.")
    .option("--no-output", "Do not write a report file (stdout only).")
    .option("--embed", "Embed screenshots inline (markdown only).", false)
    .option("--record", "Record a video of the capture (Playwright .webm).", false)
    .option("--no-full-page", "Capture only the viewport (above-the-fold), not full page.")
    .option("--interactions <spec>", "Path to a file or inline JSON with interaction steps.")
    .option("--ci", "Exit with non-zero code if issues exceed the configured threshold.", false)
    .option("--threshold <severity>", `CI severity threshold: ${VALID_SEVERITIES.join("|")}.`)
    .option("--max-findings <n>", "Keep only the top N findings per run, severity-ordered (agent focus).")
    .option("--max-pr-annotations <n>", "SARIF only: emit at most N results per report, severity-ordered (reviewer fatigue).")
    .option("--baseline <path>", "Baseline file of finding ids to suppress (default: .motionlintignore).")
    .option("--new-only", "Report only findings not seen in prior runs of the same URL.", false)
    .option("--no-memory", "Disable cross-run memory: no finding ids, no baseline, no state written.")
    .option("--quiet", "Suppress per-issue terminal output (still writes report file).", false)
    .action(async (url: string, opts: ReviewOptions) => {
      try {
        await runReviewCommand(url, opts);
      } catch (err) {
        fail((err as Error).message);
      }
    });

  program
    .command("eval")
    .description("Run the labeled-truth eval harness against a vision provider. Held-out labels are NEVER sent to the model.")
    .option("--truth <path>", "Path to truth.json.", "eval/truth.json")
    .option("--fixtures <dir>", "Path to fixtures directory.", "eval/fixtures")
    .option("--provider <name>", "Provider override (auto|ollama|anthropic|openai|google|mock).")
    .option("--model <name>", "Model override.")
    .option("--only <list>", "Comma-separated fixture names to run (spans all levels).")
    .option("--levels <list>", "Comma-separated level names (e.g. L1-basic,L2-intermediate). Defaults to all in truth.json.")
    .option("--no-stop-on-fail", "Continue evaluating later levels even if an earlier one fails (default: stop).")
    .option("-o, --output <path>", "Markdown scorecard path.", ".motionlint/reports/eval.md")
    .option("--json <path>", "Also write the raw eval report JSON to this path.")
    .option("--screenshots <dir>", "Save graded screenshots here.", ".motionlint/eval-screenshots")
    .option("--mosaic", "Stack all viewports of a fixture into one image per call (better for L3 viewport-conditional faults).", false)
    .option("--with-dom", "Send authoritative DOM measurements (sizes, overflow, contrast estimate) alongside the screenshot.", false)
    .option("--consistency <n>", "Self-consistency samples per fixture (1=off, 3=recommended).", "1")
    .option("--ci", "Exit non-zero when the eval is failing on any attempted level.", false)
    .option("--quiet", "Suppress per-fixture progress output.", false)
    .action(async (opts: EvalCliOptions) => {
      try {
        await runEvalCommand(opts);
      } catch (err) {
        fail((err as Error).message);
      }
    });

  program
    .command("flow")
    .description("Run a scripted user flow with Playwright, record it, and have a vision LLM review the animation/interaction quality across the captured frames.")
    .option("-u, --url <url>", "Base URL for the flow (required for inline --steps).")
    .option("-s, --steps <dsl>", "Inline flow DSL: semicolon-separated steps. e.g. \"navigate /signup; type input#email=ada@example.com; click button[type=submit]; wait 2000; capture\".")
    .option("--spec <path>", "Path to a flow spec JSON file (alternative to --steps).")
    .option("--name <name>", "Human label for this flow (used in the report filename). Defaults to the spec's name.")
    .option("--provider <name>", "Provider override (auto|ollama|anthropic|openai|google|mock).")
    .option("--model <name>", "Model override.")
    .option("--consistency <n>", "Self-consistency samples (1=off, 3=recommended for harder flows).", "1")
    .option("--no-record", "Skip the Playwright video recording (only the contact sheet is produced).")
    .option("--no-implicit-bursts", "Only burst-capture on explicit `capture` steps; default is to burst after every interaction.")
    .option("--preferences <path>", "Path to a markdown file with team motion preferences and inspirations. Embedded into the prompt and the report.")
    .option("--burst-fullpage", "Use the screenshot strategy with full-page captures in each burst frame (~250ms each, slower). Default is the screencast strategy.", false)
    .option("--burst-strategy <name>", "Burst strategy: 'screencast' (default, ~8ms per shot via CDP) or 'screenshot' (legacy, ~150-200ms).", "screencast")
    .option("--interval <ms>", "Inter-frame burst interval in ms. Default 50 (sub-100ms human-detection threshold; below industry-typical 100ms minimum).", "50")
    .option("--burst-ms <ms>", "Burst window per step in ms. Default 750 (with --interval 50 → 16 frames per step).", "750")
    .option("--auto-interval", "Scan animations on the page first and pick an interval that captures the shortest animation cleanly (4 frames during it). Falls back to --interval if scan finds nothing.", false)
    .option("-o, --output <path>", "Markdown report path. Default: .motionlint/flows/<flow-name>.md.")
    .option("--embed", "Embed the contact sheet inline in the markdown report.", false)
    .option("--ci", "Exit non-zero when any critical finding is reported.", false)
    .option("--quiet", "Suppress per-step progress output.", false)
    .action(async (opts: FlowCliOptions) => {
      try {
        await runFlowCommand(opts);
      } catch (err) {
        fail((err as Error).message);
      }
    });

  program
    .command("tune <url>")
    .description("Detect animations on a running app and open an interactive tuner. Adjust live, export a prompt for Claude Code.")
    .option("-o, --output <path>", "Path to write the tuner HTML.", ".motionlint/tuner/index.html")
    .option("--viewport <wxh>", "Capture viewport, e.g. 1280x800.", "1280x800")
    .option("--settle <ms>", "Time to wait after load for animations to register.", "1500")
    .option("--open", "Open the generated tuner in the default browser.", false)
    .option("--quiet", "Suppress progress output.", false)
    .action(async (url: string, opts: TuneCliOptions) => {
      try {
        await runTuneCommand(url, opts);
      } catch (err) {
        fail((err as Error).message);
      }
    });

  program
    .command("mcp")
    .description("Run MotionLint as an MCP server over stdio (for Claude Code).")
    .action(async () => {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer();
    });

  return program;
}

interface FlowCliOptions {
  url?: string;
  steps?: string;
  spec?: string;
  name?: string;
  provider?: string;
  model?: string;
  consistency?: string;
  record?: boolean;
  implicitBursts?: boolean;
  preferences?: string;
  burstFullpage?: boolean;
  burstStrategy?: string;
  interval?: string;
  burstMs?: string;
  autoInterval?: boolean;
  output?: string;
  embed?: boolean;
  ci?: boolean;
  quiet?: boolean;
}

async function runFlowCommand(opts: FlowCliOptions): Promise<void> {
  const { runFlow } = await import("../flow/runner.js");
  const { renderFlowMarkdownReport } = await import("../flow/report.js");
  const { loadFlowSpec, resolveFlowOverrides } = await import("../flow/spec.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname: dn, resolve: resolvePath } = await import("node:path");

  const specSource = opts.spec ?? opts.steps;
  if (!specSource) throw new Error("Provide either --spec <path> or --steps <inline DSL>.");
  const parsed = await loadFlowSpec(specSource, opts.url);
  const { spec: named, outputPath } = resolveFlowOverrides(parsed, { name: opts.name, output: opts.output });

  // Burst-interval resolution: spec value (if any) > --auto-interval scan > --interval flag > 50ms.
  const cliInterval = Math.max(20, Math.min(500, Number(opts.interval ?? 50)));
  const cliBurstMs = Math.max(120, Number(opts.burstMs ?? 750));
  let scannedInterval: number | undefined;
  if (opts.autoInterval) {
    const { recommendIntervalMs } = await import("../flow/auto_interval.js");
    if (!opts.quiet) console.error(kleur.gray(`  scanning ${named.url} for animations…`));
    const rec = await recommendIntervalMs(named.url);
    if (!opts.quiet) console.error(kleur.gray(`  ${rec.reasoning}`));
    scannedInterval = rec.interval_ms;
  }
  const spec = {
    ...named,
    burst_interval_ms: named.burst_interval_ms ?? scannedInterval ?? cliInterval,
    burst_ms: named.burst_ms ?? cliBurstMs,
  };

  if (!opts.quiet) console.error(kleur.cyan(`→ Running flow "${spec.name}" against ${spec.url} (${spec.steps.length} steps, ${spec.burst_interval_ms}ms intervals × ${spec.burst_ms}ms window)`));

  const report = await runFlow({
    spec,
    provider: opts.provider,
    model: opts.model ?? null,
    consistency: Math.max(1, Number(opts.consistency ?? 1)),
    artifactDir: ".motionlint/flows",
    videoDir: opts.record === false ? undefined : ".motionlint/videos",
    noImplicitBursts: opts.implicitBursts === false,
    burstFullPage: opts.burstFullpage === true,
    burstStrategy: (opts.burstStrategy === "screenshot" ? "screenshot" : "screencast"),
    preferencesPath: opts.preferences,
    onProgress: (event) => {
      if (opts.quiet) return;
      switch (event.type) {
        case "provider_resolved":
          console.error(kleur.gray(`  provider: ${event.name} (${event.model})`));
          break;
        case "capture_started":
          console.error(kleur.gray(`  capturing flow…`));
          break;
        case "step_done":
          console.error(`  ${event.success ? kleur.green("✓") : kleur.red("✗")} step ${event.step_index + 1}: ${event.frames_captured} frame${event.frames_captured === 1 ? "" : "s"}`);
          break;
        case "capture_finished":
          console.error(kleur.gray(`  captured ${event.total_frames} frames in ${event.duration_ms}ms`));
          break;
        case "contact_sheet_built":
          console.error(kleur.gray(`  contact sheet → ${event.path}`));
          break;
        case "analysis_started":
          console.error(kleur.gray(`  analyzing flow…`));
          break;
      }
    },
  });

  const outPath = resolvePath(outputPath);
  await mkdir(dn(outPath), { recursive: true });
  await writeFile(outPath, renderFlowMarkdownReport(report, { reportDir: dn(outPath), embedSheet: opts.embed ?? false }), "utf8");
  console.error(kleur.green(`  report → ${outPath}`));
  if (report.video_path) console.error(kleur.gray(`  video  → ${report.video_path}`));

  if (opts.ci) {
    const criticals = report.analysis.issues.filter((i) => i.severity === "critical").length;
    if (criticals > 0) process.exit(1);
  }
}

interface TuneCliOptions {
  output?: string;
  viewport?: string;
  settle?: string;
  open?: boolean;
  quiet?: boolean;
}

async function runTuneCommand(url: string, opts: TuneCliOptions): Promise<void> {
  const { extractAnimations } = await import("../tuner/extract.js");
  const { renderTunerHTML } = await import("../tuner/render.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname, resolve: resolvePath } = await import("node:path");

  const [w, h] = (opts.viewport ?? "1280x800").split("x").map(Number);
  const settle = Number(opts.settle ?? 1500);

  if (!opts.quiet) console.error(kleur.cyan(`→ Capturing animations on ${url}…`));
  const capture = await extractAnimations({
    url,
    viewport: { width: w || 1280, height: h || 800 },
    settleMs: settle,
  });
  if (!opts.quiet) console.error(kleur.gray(`  detected ${capture.animations.length} animation(s)`));

  const html = renderTunerHTML(capture);
  const outPath = resolvePath(opts.output ?? ".motionlint/tuner/index.html");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");
  console.error(kleur.green(`  tuner → ${outPath}`));
  console.error(kleur.gray(`  open with: file://${outPath}`));

  if (opts.open) {
    const { spawn } = await import("node:child_process");
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [outPath], { detached: true, stdio: "ignore" }).unref();
  }
}

interface EvalCliOptions {
  truth?: string;
  fixtures?: string;
  provider?: string;
  model?: string;
  only?: string;
  levels?: string;
  stopOnFail?: boolean;
  output?: string;
  json?: string;
  screenshots?: string;
  mosaic?: boolean;
  withDom?: boolean;
  consistency?: string;
  ci?: boolean;
  quiet?: boolean;
}

async function runEvalCommand(opts: EvalCliOptions): Promise<void> {
  const { runEval } = await import("../eval/runner.js");
  const { renderEvalReport } = await import("../eval/report.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");

  const report = await runEval({
    truthPath: opts.truth ?? "eval/truth.json",
    fixturesDir: opts.fixtures ?? "eval/fixtures",
    provider: opts.provider,
    model: opts.model ?? null,
    only: opts.only?.split(",").map((s) => s.trim()).filter(Boolean),
    onlyLevels: opts.levels?.split(",").map((s) => s.trim()).filter(Boolean),
    stopOnFail: opts.stopOnFail !== false,
    screenshotDir: opts.screenshots,
    mosaic: opts.mosaic ?? false,
    withDom: opts.withDom ?? false,
    consistency: Math.max(1, Number(opts.consistency ?? 1)),
    onProgress: (event) => {
      if (opts.quiet) return;
      switch (event.type) {
        case "server_started":
          console.error(kleur.gray(`  fixtures server: ${event.url}`));
          break;
        case "level_start":
          console.error(kleur.bold().underline(`\n  Level ${event.level} (${event.fixtures} fixtures)`));
          break;
        case "fixture_start":
          console.error(kleur.gray(`    → ${event.fixture} @ ${event.viewport}`));
          break;
        case "fixture_scored": {
          const s = event.score;
          const tag = s.expected === 0
            ? (s.control_violation ? kleur.red("    ✗ control violated") : kleur.green("    ✓ control clean"))
            : (s.detected === s.expected ? kleur.green(`    ✓ ${s.detected}/${s.expected}`) : kleur.yellow(`    ~ ${s.detected}/${s.expected}`));
          console.error(`${tag}  surprise: ${s.surprise_critical} crit / ${s.surprise_warning} warn`);
          break;
        }
        case "level_done": {
          const r = event.result;
          const status = r.passing ? kleur.green(`    ✅ ${r.level} PASS`) : kleur.red(`    ❌ ${r.level} FAIL`);
          console.error(`${status}  recall=${(r.recall * 100).toFixed(1)}% controls=${r.control_violations}`);
          if (r.failure_reason) console.error(kleur.dim(`      reason: ${r.failure_reason}`));
          break;
        }
        default:
          break;
      }
    },
  });

  const outPath = opts.output ?? ".motionlint/reports/eval.md";
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, renderEvalReport(report), "utf8");
  console.error(kleur.green(`\n  scorecard → ${outPath}`));

  if (opts.json) {
    await mkdir(dirname(opts.json), { recursive: true });
    await writeFile(opts.json, JSON.stringify(report, null, 2), "utf8");
    console.error(kleur.green(`  json      → ${opts.json}`));
  }

  console.error("");
  console.error(`  Highest passing level: ${report.highest_passing_level ?? "(none)"}`);
  console.error(`  First failing level:   ${report.first_failing_level ?? "(none)"}`);
  console.error(report.overall_passing ? kleur.green("  ✅ EVAL OVERALL PASSING") : kleur.red("  ❌ EVAL OVERALL FAILING"));

  if (opts.ci && !report.overall_passing) process.exit(1);
}

function collectViewport(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${flag}: ${value}. Use a positive integer.`);
  }
  return n;
}

interface ReviewOptions {
  routes?: string;
  viewport?: string[];
  viewports?: string;
  provider?: string;
  model?: string;
  rules?: string;
  format?: string;
  /** string from -o/--output; false from --no-output; undefined = default report dir */
  output?: string | false;
  embed?: boolean;
  record?: boolean;
  fullPage?: boolean;
  interactions?: string;
  ci?: boolean;
  threshold?: string;
  maxFindings?: string;
  maxPrAnnotations?: string;
  baseline?: string;
  newOnly?: boolean;
  memory?: boolean;
  quiet?: boolean;
}

function resolveViewports(opts: ReviewOptions): string[] | undefined {
  if (opts.viewports) return opts.viewports.split(",").map((s) => s.trim()).filter(Boolean);
  if (opts.viewport && opts.viewport.length > 0) return opts.viewport;
  return undefined;
}

async function readInteractions(input: string | undefined) {
  if (!input) return undefined;
  try {
    if (input.trim().startsWith("[")) return parseInteractionsFromString(input);
    return parseInteractionsFromString(await readFile(input, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read interactions: ${(err as Error).message}`);
  }
}

function buildUrlList(base: string, routes?: string): string[] {
  if (!routes) return [base];
  const parts = routes.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return [base];
  const url = new URL(base);
  return parts.map((p) => {
    if (/^https?:\/\//i.test(p)) return p;
    const u = new URL(url.toString());
    u.pathname = p.startsWith("/") ? p : `/${p}`;
    return u.toString();
  });
}

async function runReviewCommand(rawUrl: string, opts: ReviewOptions): Promise<void> {
  const config = await loadConfig();
  const format = (opts.format ?? "md") as OutputFormat;
  if (!VALID_FORMATS.includes(format)) {
    throw new Error(`Invalid --format: ${format}. Use one of ${VALID_FORMATS.join(", ")}`);
  }
  if (opts.threshold && !VALID_SEVERITIES.includes(opts.threshold as IssueSeverity)) {
    throw new Error(`Invalid --threshold: ${opts.threshold}. Use one of ${VALID_SEVERITIES.join(", ")}`);
  }
  if (opts.threshold) config.ci.threshold = opts.threshold as IssueSeverity;

  const maxFindings = parsePositiveInt(opts.maxFindings, "--max-findings");
  const maxPrAnnotations = parsePositiveInt(opts.maxPrAnnotations, "--max-pr-annotations");

  const interactions = await readInteractions(opts.interactions);
  const targets = buildUrlList(rawUrl, opts.routes);

  let highestExit = 0;
  for (const url of targets) {
    if (!opts.quiet) console.error(kleur.cyan(`→ Reviewing ${url}`));
    const result = await runReview({
      url,
      config,
      provider: opts.provider,
      model: opts.model ?? null,
      viewports: resolveViewports(opts),
      rulesPath: opts.rules ?? null,
      record: opts.record ?? false,
      fullPage: opts.fullPage ?? true,
      interactions,
      format,
      outputPath: opts.output === false ? null : opts.output ?? undefined,
      embedScreenshots: opts.embed ?? false,
      maxFindings,
      maxPrAnnotations,
      // commander defaults negated flags to true, so only an explicit --no-memory overrides config
      memory: opts.memory === false ? false : undefined,
      baselinePath: opts.baseline ?? undefined,
      newOnly: opts.newOnly === true ? true : undefined,
      onProgress: (event) => {
        if (opts.quiet) return;
        switch (event.type) {
          case "provider_resolved":
            console.error(kleur.gray(`  provider: ${event.provider.name} (${event.provider.model})`));
            break;
          case "capture_start":
            console.error(kleur.gray(`  capturing ${event.viewport.name} (${event.viewport.width}×${event.viewport.height})…`));
            break;
          case "analyze_start":
            console.error(kleur.gray(`  analyzing ${event.viewport.name}…`));
            break;
          case "memory_warning":
            console.error(kleur.yellow(`  memory: ${event.message}`));
            break;
          case "report_written":
            console.error(kleur.green(`  report → ${event.path}`));
            break;
          default:
            break;
        }
      },
    });

    if (!opts.quiet) {
      if (format === "md") {
        process.stdout.write(summarize(result.report) + "\n");
      } else {
        process.stdout.write(result.rendered + "\n");
      }
    }

    if (opts.ci && result.exitCode > highestExit) highestExit = result.exitCode;
  }

  if (opts.ci) process.exit(highestExit);
}
