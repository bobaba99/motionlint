import type { AnalysisResult, VisionProvider } from "../types.js";
import { parseAnalysisResponse } from "../analysis/parser.js";
import { usageFromAnthropic } from "../resources/usage.js";
import { compressForLLM } from "./util.js";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements VisionProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? "claude-sonnet-5";
    // 4096 truncated real reviews. Measured 2026-07-27 on the 12-scroll stress
    // fixture with claude-opus-5: at 4096 the API returned stop_reason
    // "max_tokens" and unparseable JSON; at 16384 it returned end_turn in 3613
    // tokens and parsed cleanly. Headroom is free — you are billed for tokens
    // produced, not for the cap.
    this.maxTokens = opts.maxTokens ?? 16384;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async analyze(screenshot: Buffer, prompt: string, viewportName: string): Promise<AnalysisResult> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY missing");

    const { data, mediaType } = await compressForLLM(screenshot, { format: "jpeg" });

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };

    // A truncated response must fail loudly. Left unchecked it reaches the parser
    // as malformed JSON and comes back as `overall_score: 0, issues: []`, which is
    // indistinguishable from a clean review — so the tool reports "no issues
    // found" precisely when it had the most to say.
    if (json.stop_reason === "max_tokens") {
      throw new Error(
        `Anthropic response hit the ${this.maxTokens}-token cap and was truncated mid-JSON. ` +
          `Raise maxTokens for this model rather than trusting a partial review.`,
      );
    }

    const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    if (!text.trim()) {
      throw new Error(`Anthropic returned no text content (stop_reason: ${json.stop_reason ?? "unknown"}).`);
    }

    return { ...parseAnalysisResponse(text, viewportName), usage: usageFromAnthropic(json) };
  }
}
