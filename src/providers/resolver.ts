import type { VisionProvider } from "../types.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { MockProvider } from "./mock.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";

export interface ResolveProviderOptions {
  provider?: string;
  model?: string | null;
  fallbackProvider?: string;
  fallbackModel?: string | null;
  allowMock?: boolean;
}

function instantiate(name: string, model: string | null | undefined): VisionProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(model ? { model } : {});
    case "openai":
      return new OpenAIProvider(model ? { model } : {});
    case "google":
      return new GoogleProvider(model ? { model } : {});
    case "ollama":
      return new OllamaProvider(model ? { model } : {});
    case "mock":
      return new MockProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

const AUTO_ORDER: ReadonlyArray<string> = ["ollama", "anthropic", "openai", "google"];

export async function resolveProvider(opts: ResolveProviderOptions = {}): Promise<VisionProvider> {
  const requested = opts.provider ?? "auto";

  if (requested !== "auto") {
    const primary = instantiate(requested, opts.model ?? null);
    if (await primary.isAvailable()) return primary;

    if (opts.fallbackProvider) {
      const fallback = instantiate(opts.fallbackProvider, opts.fallbackModel ?? null);
      if (await fallback.isAvailable()) return fallback;
    }

    if (opts.allowMock !== false) return new MockProvider();
    throw new Error(
      `Provider "${requested}" is not available (missing API key or service unreachable). ` +
      `Set the corresponding env var or pass --provider mock for a dry run.`,
    );
  }

  for (const name of AUTO_ORDER) {
    const candidate = instantiate(name, name === requested ? (opts.model ?? null) : null);
    if (await candidate.isAvailable()) return candidate;
  }

  if (opts.allowMock !== false) return new MockProvider();
  throw new Error(
    "No vision provider available. Start Ollama, or set ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY.",
  );
}
