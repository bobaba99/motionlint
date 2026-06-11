import { readFile } from "node:fs/promises";
import type { FlowSpec, FlowStep, FlowAction } from "./types.js";

const VALID_ACTIONS: ReadonlySet<FlowAction> = new Set([
  "navigate", "click", "hover", "type", "scroll", "wait", "press", "capture",
]);

/**
 * Parses a tiny inline DSL into FlowStep[].
 *
 * Format: semicolon- or newline-separated statements.
 *   navigate /pricing
 *   click button#start
 *   type input#email=ada@example.com
 *   hover .feature
 *   wait 500
 *   capture "after submit"
 *   scroll 600
 *   press Enter
 *
 * Whitespace flexible. Quotes optional around capture labels.
 */
export function parseInlineSteps(input: string): FlowStep[] {
  const lines = input
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return lines.map((line) => parseLine(line));
}

function parseLine(line: string): FlowStep {
  const match = line.match(/^(\w+)(?:\s+(.*))?$/);
  if (!match) throw new Error(`Cannot parse flow step: "${line}"`);
  const action = match[1].toLowerCase() as FlowAction;
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`Unknown flow action "${action}". Valid: ${[...VALID_ACTIONS].join(", ")}`);
  }
  const rest = (match[2] ?? "").trim();

  switch (action) {
    case "navigate":
      return { do: "navigate", value: rest };
    case "click":
    case "hover":
      if (!rest) throw new Error(`${action} requires a selector: ${line}`);
      return { do: action, selector: rest };
    case "type": {
      // selector=value — value may itself contain '='
      const eq = rest.indexOf("=");
      if (eq < 0) throw new Error(`type requires selector=value: ${line}`);
      return { do: "type", selector: rest.slice(0, eq).trim(), value: rest.slice(eq + 1) };
    }
    case "press":
      return { do: "press", value: rest || "Enter" };
    case "scroll":
      return { do: "scroll", ms: Number(rest) || 600 };
    case "wait":
      return { do: "wait", ms: Number(rest) || 500 };
    case "capture": {
      const label = rest.replace(/^["']|["']$/g, "").trim() || undefined;
      return { do: "capture", label };
    }
  }
}

export async function loadFlowSpec(pathOrInline: string, fallbackUrl?: string): Promise<FlowSpec> {
  const trimmed = pathOrInline.trim();

  // JSON file path?
  if (trimmed.endsWith(".json") || trimmed.startsWith("{")) {
    const json = trimmed.startsWith("{") ? trimmed : await readFile(trimmed, "utf8");
    const parsed = JSON.parse(json) as Partial<FlowSpec>;
    if (!parsed.url && fallbackUrl) parsed.url = fallbackUrl;
    if (!parsed.url) throw new Error("Flow spec must include a url.");
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error("Flow spec must include at least one step.");
    }
    return {
      name: parsed.name ?? "flow",
      url: parsed.url,
      viewport: parsed.viewport,
      expected_animations: parsed.expected_animations,
      steps: parsed.steps as FlowStep[],
    };
  }

  // Inline DSL
  if (!fallbackUrl) {
    throw new Error("Inline flow steps require a base URL passed via --url.");
  }
  const steps = parseInlineSteps(trimmed);
  return { name: "flow", url: fallbackUrl, steps };
}

/** Filesystem-safe slug for a flow name, used for contact-sheet and report filenames. */
export function flowSlug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "flow";
}

export interface FlowCliOverrides {
  /** --name, only when explicitly passed on the CLI. */
  name?: string;
  /** -o/--output, only when explicitly passed on the CLI. */
  output?: string;
}

/**
 * Applies CLI overrides to a parsed spec without mutating it and resolves the
 * report path: an explicit --output wins; otherwise each flow gets its own
 * .motionlint/flows/<slug>.md so runs of different flows never clobber each other.
 */
export function resolveFlowOverrides(
  spec: FlowSpec,
  overrides: FlowCliOverrides,
): { spec: FlowSpec; outputPath: string } {
  const name = overrides.name || spec.name;
  return {
    spec: { ...spec, name },
    outputPath: overrides.output ?? `.motionlint/flows/${flowSlug(name)}.md`,
  };
}
