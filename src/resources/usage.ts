/**
 * Token-usage normalization. Every provider reports usage under a different
 * shape and vocabulary; these helpers map each raw payload onto the shared
 * TokenUsage type and keep run totals. Missing or malformed usage blocks map
 * to undefined — a provider that reports nothing simply contributes nothing.
 */
import type { RunUsage, TokenUsage } from "../types.js";

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usage(input: unknown, output: unknown): TokenUsage | undefined {
  const input_tokens = count(input);
  const output_tokens = count(output);
  if (input_tokens === 0 && output_tokens === 0) return undefined;
  return { input_tokens, output_tokens, total_tokens: input_tokens + output_tokens };
}

/** Anthropic Messages API: `usage.input_tokens` / `usage.output_tokens`. */
export function usageFromAnthropic(raw: unknown): TokenUsage | undefined {
  const u = (raw as { usage?: { input_tokens?: unknown; output_tokens?: unknown } })?.usage;
  return usage(u?.input_tokens, u?.output_tokens);
}

/** OpenAI chat completions: `usage.prompt_tokens` / `usage.completion_tokens`. */
export function usageFromOpenAI(raw: unknown): TokenUsage | undefined {
  const u = (raw as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } })?.usage;
  return usage(u?.prompt_tokens, u?.completion_tokens);
}

/** Google generateContent: `usageMetadata.promptTokenCount` / `candidatesTokenCount`. */
export function usageFromGoogle(raw: unknown): TokenUsage | undefined {
  const u = (raw as { usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown } })?.usageMetadata;
  return usage(u?.promptTokenCount, u?.candidatesTokenCount);
}

/** Ollama generate: top-level `prompt_eval_count` / `eval_count`. */
export function usageFromOllama(raw: unknown): TokenUsage | undefined {
  const r = raw as { prompt_eval_count?: unknown; eval_count?: unknown };
  return usage(r?.prompt_eval_count, r?.eval_count);
}

export function emptyRunUsage(limit: number | null): RunUsage {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0, calls: 0, limit, skipped_viewports: [] };
}

/** Fold one call's usage into the run total (immutable). */
export function addUsage(run: RunUsage, call: TokenUsage | undefined): RunUsage {
  return {
    ...run,
    calls: run.calls + 1,
    input_tokens: run.input_tokens + (call?.input_tokens ?? 0),
    output_tokens: run.output_tokens + (call?.output_tokens ?? 0),
    total_tokens: run.total_tokens + (call?.total_tokens ?? 0),
  };
}

/** A budget is exhausted once the run total meets or crosses it. */
export function budgetExhausted(run: RunUsage): boolean {
  return typeof run.limit === "number" && run.limit > 0 && run.total_tokens >= run.limit;
}

export function formatUsageLine(run: RunUsage): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const parts = [`${fmt(run.input_tokens)} in / ${fmt(run.output_tokens)} out · ${run.calls} call${run.calls === 1 ? "" : "s"}`];
  if (typeof run.limit === "number" && run.limit > 0) {
    parts.push(`budget ${fmt(run.limit)}`);
    if (run.skipped_viewports.length > 0) parts.push(`exhausted — skipped: ${run.skipped_viewports.join(", ")}`);
  }
  return parts.join(" · ");
}
