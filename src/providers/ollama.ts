import type { AnalysisResult, VisionProvider } from "../types.js";
import { parseAnalysisResponse } from "../analysis/parser.js";
import { usageFromOllama } from "../resources/usage.js";
import { compressForLLM } from "./util.js";

export interface OllamaProviderOptions {
  host?: string;
  model?: string;
  temperature?: number;
}

export class OllamaProvider implements VisionProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly host: string;
  private readonly temperature: number;

  constructor(opts: OllamaProviderOptions = {}) {
    this.host = opts.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.model = opts.model ?? "llava:13b";
    this.temperature = opts.temperature ?? 0.3;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      const names = (json.models ?? []).map((m) => m.name ?? "");
      // If a specific model is configured, check it exists.
      const base = this.model.split(":")[0];
      return names.length > 0 && names.some((n) => n === this.model || n.startsWith(base));
    } catch {
      return false;
    }
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    const { data } = await compressForLLM(screenshot, { format: "jpeg", quality: 80 });

    const res = await fetch(`${this.host}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        images: [data],
        stream: false,
        format: "json",
        options: { temperature: this.temperature },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama API ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as { response?: string; thinking?: string };
    // Some hybrid-architecture models (e.g. nemotron3) emit format:"json"
    // output into the `thinking` channel and leave `response` empty.
    const body = json.response?.trim() ? json.response : (json.thinking ?? "");
    return { ...parseAnalysisResponse(body, viewportName), usage: usageFromOllama(json) };
  }
}
