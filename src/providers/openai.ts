import type { AnalysisResult, VisionProvider } from "../types.js";
import { parseAnalysisResponse } from "../analysis/parser.js";
import { usageFromOpenAI } from "../resources/usage.js";
import { compressForLLM } from "./util.js";

const OPENAI_API = "https://api.openai.com/v1/chat/completions";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAIProvider implements VisionProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.model = opts.model ?? "gpt-4o";
    // OPENAI_BASE_URL points the provider at any OpenAI-compatible endpoint
    // (Moonshot/Kimi, Together, vLLM…) — pair it with that service's key.
    this.baseUrl = opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? OPENAI_API;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY missing");

    const { data, mediaType } = await compressForLLM(screenshot, { format: "jpeg" });
    const dataUrl = `data:${mediaType};base64,${data}`;

    const request = (withResponseFormat: boolean) =>
      fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          ...(withResponseFormat ? { response_format: { type: "json_object" } } : {}),
          messages: [{
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });

    let res = await request(true);
    if (!res.ok && [400, 401, 403].includes(res.status)) {
      // Some models/tiers and OpenAI-compatible endpoints reject
      // response_format — the prompt already demands JSON, so retry without.
      res = await request(false);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string; refusal?: string; reasoning_content?: string };
        finish_reason?: string;
      }>;
    };
    const choice = json.choices?.[0];

    // All three of these arrive as HTTP 200, so the !res.ok throw above never
    // fires. Without these checks each becomes an empty string, then a parse
    // failure, then `overall_score: 0, issues: []` — a clean bill of health for a
    // review that never happened.
    if (choice?.finish_reason === "length") {
      throw new Error(
        "OpenAI response was truncated (finish_reason: length) and the JSON is incomplete. " +
          "Raise the completion cap rather than trusting a partial review.",
      );
    }
    if (choice?.message?.refusal) {
      throw new Error(`OpenAI refused the request: ${choice.message.refusal.slice(0, 200)}`);
    }

    // OpenAI-compatible endpoints for thinking models (Moonshot/Kimi, DeepSeek,
    // vLLM) put the answer in `reasoning_content` and leave `content` empty.
    const text = choice?.message?.content?.trim()
      ? choice.message.content
      : (choice?.message?.reasoning_content ?? "");

    if (!text.trim()) {
      throw new Error(
        `OpenAI returned no usable content (finish_reason: ${choice?.finish_reason ?? "unknown"}).`,
      );
    }

    return { ...parseAnalysisResponse(text, viewportName), usage: usageFromOpenAI(json) };
  }
}
