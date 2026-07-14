import type { AnalysisResult, VisionProvider } from "../types.js";
import { parseAnalysisResponse } from "../analysis/parser.js";
import { usageFromGoogle } from "../resources/usage.js";
import { compressForLLM } from "./util.js";

export interface GoogleProviderOptions {
  apiKey?: string;
  model?: string;
}

export class GoogleProvider implements VisionProvider {
  readonly name = "google";
  readonly model: string;
  private readonly apiKey: string | undefined;

  constructor(opts: GoogleProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GOOGLE_API_KEY;
    this.model = opts.model ?? "gemini-1.5-pro";
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    if (!this.apiKey) throw new Error("GOOGLE_API_KEY missing");

    const { data, mediaType } = await compressForLLM(screenshot, { format: "jpeg" });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.3,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google API ${res.status}: ${text.slice(0, 400)}`);
    }

    type GoogleResponse = {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const json = (await res.json()) as GoogleResponse;
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
    return { ...parseAnalysisResponse(text, viewportName), usage: usageFromGoogle(json) };
  }
}
