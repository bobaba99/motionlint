import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { runReview } from "../pipeline.js";
import { loadConfig } from "../config/loader.js";
import type { OutputFormat, ReviewReport } from "../types.js";

const TOOLS = [
  {
    name: "review_url",
    description: "Capture and analyze a URL for UI/UX issues using vision AI.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to review." },
        viewports: {
          type: "array",
          items: { type: "string", enum: ["mobile", "tablet", "desktop"] },
          description: "Viewports to capture (default: mobile + desktop).",
        },
        provider: { type: "string", description: "LLM provider override (auto|ollama|anthropic|openai|google|mock)." },
        model: { type: "string", description: "Model override." },
        wait_for: { type: "string", description: "CSS selector or 'networkidle' to wait for before capture." },
        record: { type: "boolean", description: "Record a video of the capture." },
        format: { type: "string", enum: ["md", "json", "sarif"], description: "Output format (default: md)." },
        max_findings: { type: "number", description: "Keep only the top N findings, severity-ordered (agent focus)." },
      },
      required: ["url"],
    },
  },
  {
    name: "review_routes",
    description: "Review multiple routes of an application.",
    inputSchema: {
      type: "object",
      properties: {
        base_url: { type: "string" },
        routes: { type: "array", items: { type: "string" } },
        viewports: { type: "array", items: { type: "string" } },
        provider: { type: "string" },
        model: { type: "string" },
        format: { type: "string", enum: ["md", "json", "sarif"] },
        max_findings: { type: "number", description: "Keep only the top N findings per route, severity-ordered." },
      },
      required: ["base_url", "routes"],
    },
  },
  {
    name: "review_flow",
    description: "Run a scripted user-flow review against a URL. Captures frame bursts after every interaction and asks the vision LLM to grade animation quality, missing transitions, loading-state feedback, choreography, smoothness, and flicker. Use this when the user asks about animations, interaction states, or whether a flow feels good — NOT for static design issues (use review_url for those).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Base URL for the flow (joined with each step's `navigate`)." },
        name: { type: "string", description: "Human label for the flow (used in artifact filenames). Default: 'flow'." },
        steps: {
          type: "string",
          description: "Inline DSL: semicolon-separated steps. Actions: navigate <path>, click <selector>, hover <selector>, type <selector>=<value>, press <key>, scroll <px>, wait <ms>, capture \"<label>\". e.g.: 'navigate /signup; type input#email=ada@example.com; click button[type=submit]; wait 1500; capture \"after submit\"'.",
        },
        spec_path: { type: "string", description: "Alternative to `steps`: path to a flow spec JSON file." },
        preferences_path: { type: "string", description: "Optional path to a markdown file with team motion preferences. Embedded into the prompt and the report's CC handoff block." },
        provider: { type: "string", description: "LLM provider override (auto|ollama|anthropic|openai|google|mock)." },
        model: { type: "string", description: "Model override." },
        consistency: { type: "number", description: "Self-consistency samples (1=off, 3=recommended for harder flows). Default 1." },
        record: { type: "boolean", description: "Record the full Playwright video alongside the contact sheet. Default true." },
        burst_fullpage: { type: "boolean", description: "Use full-page captures in each burst frame (slower; for in-page scroll animations). Default viewport-only." },
      },
      required: ["url"],
    },
  },
  {
    name: "tune_animations",
    description: "Detect every animation on a page (CSS transitions/keyframes plus Motion One / GSAP / anime.js / @formkit/auto-animate / lottie-web), and write an interactive HTML tuner page where the user can adjust duration/delay/easing live and export a Claude-Code-ready prompt with the parameter changes. Returns the file path of the generated tuner. Use when the user wants to fine-tune existing animation parameters, NOT to review for issues.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to capture animations from." },
        viewport_width: { type: "number", description: "Capture viewport width. Default 1280." },
        viewport_height: { type: "number", description: "Capture viewport height. Default 800." },
        settle_ms: { type: "number", description: "Time to wait after load for animations to register. Default 1500." },
        output: { type: "string", description: "Where to write the tuner HTML. Default .motionlint/tuner/index.html." },
      },
      required: ["url"],
    },
  },
  {
    name: "get_latest_report",
    description: "Return the most recent UX review report content.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["md", "json"] },
      },
    },
  },
] as const;

interface ReviewUrlArgs {
  url: string;
  viewports?: string[];
  provider?: string;
  model?: string;
  wait_for?: string;
  record?: boolean;
  format?: OutputFormat;
  max_findings?: number;
}

interface ReviewRoutesArgs {
  base_url: string;
  routes: string[];
  viewports?: string[];
  provider?: string;
  model?: string;
  format?: OutputFormat;
  max_findings?: number;
}

interface ReviewFlowArgs {
  url: string;
  name?: string;
  steps?: string;
  spec_path?: string;
  preferences_path?: string;
  provider?: string;
  model?: string;
  consistency?: number;
  record?: boolean;
  burst_fullpage?: boolean;
}

interface TuneAnimationsArgs {
  url: string;
  viewport_width?: number;
  viewport_height?: number;
  settle_ms?: number;
  output?: string;
}

let lastReport: { rendered: string; format: OutputFormat; report: ReviewReport; path: string | null } | null = null;

async function handleReviewUrl(args: ReviewUrlArgs) {
  const config = await loadConfig();
  if (args.wait_for) config.waitFor = args.wait_for;

  const result = await runReview({
    url: args.url,
    config,
    provider: args.provider,
    model: args.model ?? null,
    viewports: args.viewports,
    record: args.record ?? false,
    format: args.format ?? "md",
    maxFindings: args.max_findings,
  });
  lastReport = { rendered: result.rendered, format: result.format, report: result.report, path: result.reportPath };
  return result;
}

async function handleReviewRoutes(args: ReviewRoutesArgs) {
  const renderedParts: string[] = [];
  let last: { report: ReviewReport; path: string | null; format: OutputFormat } | null = null;
  for (const route of args.routes) {
    const url = /^https?:\/\//i.test(route) ? route : new URL(route, args.base_url).toString();
    const result = await handleReviewUrl({
      url,
      viewports: args.viewports,
      provider: args.provider,
      model: args.model,
      format: args.format ?? "md",
      max_findings: args.max_findings,
    });
    renderedParts.push(result.rendered);
    last = { report: result.report, path: result.reportPath, format: result.format };
  }
  return { rendered: renderedParts.join("\n\n---\n\n"), ...last! };
}

async function handleReviewFlow(args: ReviewFlowArgs): Promise<string> {
  const { runFlow } = await import("../flow/runner.js");
  const { renderFlowMarkdownReport } = await import("../flow/report.js");
  const { loadFlowSpec } = await import("../flow/spec.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname, resolve } = await import("node:path");

  const specSource = args.spec_path ?? args.steps;
  if (!specSource) throw new Error("review_flow requires either `steps` (inline DSL) or `spec_path`.");
  const spec = await loadFlowSpec(specSource, args.url);
  if (args.name) spec.name = args.name;

  const report = await runFlow({
    spec,
    provider: args.provider,
    model: args.model ?? null,
    consistency: Math.max(1, Number(args.consistency ?? 1)),
    artifactDir: ".motionlint/flows",
    videoDir: args.record === false ? undefined : ".motionlint/videos",
    burstFullPage: args.burst_fullpage === true,
    preferencesPath: args.preferences_path,
  });

  const outDir = resolve(".motionlint/flows");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = (spec.name || "flow").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const outPath = resolve(outDir, `${slug}-${stamp}.md`);
  const md = renderFlowMarkdownReport(report, { reportDir: dirname(outPath), embedSheet: false });
  await writeFile(outPath, md, "utf8");
  return md;
}

async function handleTuneAnimations(args: TuneAnimationsArgs): Promise<string> {
  const { extractAnimations } = await import("../tuner/extract.js");
  const { renderTunerHTML } = await import("../tuner/render.js");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname, resolve } = await import("node:path");

  const capture = await extractAnimations({
    url: args.url,
    viewport: { width: args.viewport_width ?? 1280, height: args.viewport_height ?? 800 },
    settleMs: args.settle_ms ?? 1500,
  });
  const html = renderTunerHTML(capture);
  const outPath = resolve(args.output ?? ".motionlint/tuner/index.html");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, "utf8");

  return [
    `Animation tuner generated: file://${outPath}`,
    `Detected ${capture.animations.length} animation${capture.animations.length === 1 ? "" : "s"} on ${capture.url}.`,
    "",
    "Tell the user to open that file in a browser. They can adjust duration/delay/easing per animation with sliders, then click 'Export prompt for Claude Code' to get a markdown block with their changes — paste it back into this conversation to apply the edits.",
  ].join("\n");
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "motionlint", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: "motionlint://reports/latest",
      name: "Latest MotionLint report",
      description: "The most recent UX review produced by this server.",
      mimeType: "text/markdown",
    }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== "motionlint://reports/latest") {
      throw new Error(`Unknown resource: ${req.params.uri}`);
    }
    if (!lastReport) {
      return { contents: [{ uri: req.params.uri, mimeType: "text/plain", text: "No report has been generated yet." }] };
    }
    if (lastReport.path) {
      const text = await readFile(lastReport.path, "utf8");
      const mt = lastReport.format === "md" ? "text/markdown" : "application/json";
      return { contents: [{ uri: req.params.uri, mimeType: mt, text }] };
    }
    return { contents: [{ uri: req.params.uri, mimeType: "text/markdown", text: lastReport.rendered }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      switch (req.params.name) {
        case "review_url": {
          const args = (req.params.arguments ?? {}) as unknown as ReviewUrlArgs;
          const result = await handleReviewUrl(args);
          return { content: [{ type: "text", text: result.rendered }] };
        }
        case "review_routes": {
          const args = (req.params.arguments ?? {}) as unknown as ReviewRoutesArgs;
          const result = await handleReviewRoutes(args);
          return { content: [{ type: "text", text: result.rendered }] };
        }
        case "review_flow": {
          const args = (req.params.arguments ?? {}) as unknown as ReviewFlowArgs;
          const md = await handleReviewFlow(args);
          return { content: [{ type: "text", text: md }] };
        }
        case "tune_animations": {
          const args = (req.params.arguments ?? {}) as unknown as TuneAnimationsArgs;
          const text = await handleTuneAnimations(args);
          return { content: [{ type: "text", text }] };
        }
        case "get_latest_report": {
          if (!lastReport) {
            return { content: [{ type: "text", text: "No report yet. Call review_url first." }] };
          }
          if (lastReport.path) {
            const text = await readFile(lastReport.path, "utf8");
            return { content: [{ type: "text", text }] };
          }
          return { content: [{ type: "text", text: lastReport.rendered }] };
        }
        default:
          return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
      }
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
