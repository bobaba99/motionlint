import type { AnalysisResult, VisionProvider } from "../types.js";
import { parseAnalysisResponse } from "../analysis/parser.js";
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
    this.baseUrl = opts.baseUrl ?? OPENAI_API;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY missing");

    const { data, mediaType } = await compressForLLM(screenshot, { format: "jpeg" });
    const dataUrl = `data:${mediaType};base64,${data}`;

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? "";
    return parseAnalysisResponse(text, viewportName);
  }
}
