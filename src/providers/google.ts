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
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
    };
    const json = (await res.json()) as GoogleResponse;

    // Gemini returns HTTP 200 for blocked and truncated generations alike, so the
    // !res.ok throw above never fires. Each of these would otherwise land in the
    // parser as an empty string and surface as a clean review.
    if (json.promptFeedback?.blockReason) {
      throw new Error(`Google blocked the request (${json.promptFeedback.blockReason}) — nothing was reviewed.`);
    }

    const candidate = json.candidates?.[0];
    const finish = candidate?.finishReason;
    if (finish && finish !== "STOP") {
      throw new Error(
        `Google stopped generating early (finishReason: ${finish}) — the review is incomplete, not clean.`,
      );
    }

    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("\n");
    if (!text.trim()) {
      throw new Error(`Google returned no text content (finishReason: ${finish ?? "unknown"}).`);
    }

    return { ...parseAnalysisResponse(text, viewportName), usage: usageFromGoogle(json) };
  }
}
