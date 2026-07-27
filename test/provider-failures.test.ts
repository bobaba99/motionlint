import { afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { GoogleProvider } from "../src/providers/google.js";

// All three cloud providers answer HTTP 200 for generations that were truncated,
// refused, safety-blocked, or written to a channel the client never reads — so
// the `!res.ok` guard never fires. Before these checks, the unusable body flowed
// into parseAnalysisResponse and came back as `overall_score: 0, issues: []`,
// which downstream code cannot tell apart from a review that genuinely found
// nothing. The HTML report then rendered "Clean bill of health".
//
// The failure inverted with severity: more issues -> longer response -> likelier
// truncation. The tool broke hardest on the pages that needed it most.
//
// Every case below MUST throw. A returned AnalysisResult is the bug.

const realFetch = globalThis.fetch;

// Providers run the buffer through sharp (compressForLLM) before the request, so
// this has to be a genuinely decodable PNG. Generate it with sharp rather than
// hand-writing bytes — a malformed literal throws inside compressForLLM and every
// assertion below then fails on a decode error instead of the behaviour under test.
let PNG: Buffer;

before(async () => {
  PNG = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
});

function stub(body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

const CLEAN = JSON.stringify({
  overall_score: 7,
  summary: "ok",
  issues: [],
  strengths: [],
});

describe("providers surface unusable responses instead of reporting a clean review", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe("anthropic", () => {
    const provider = () => new AnthropicProvider({ apiKey: "test-key" });

    it("throws when the response was truncated at the token cap", async () => {
      stub({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"overall_score": 4, "summ' }] });
      await assert.rejects(() => provider().analyze(PNG, "p", "desktop"), /truncated/i);
    });

    it("throws when no text content came back", async () => {
      stub({ stop_reason: "end_turn", content: [] });
      await assert.rejects(() => provider().analyze(PNG, "p", "desktop"), /no text content/i);
    });

    it("still parses a well-formed response", async () => {
      stub({ stop_reason: "end_turn", content: [{ type: "text", text: CLEAN }] });
      const result = await provider().analyze(PNG, "p", "desktop");
      assert.equal(result.overall_score, 7);
    });
  });

  describe("openai", () => {
    const provider = () => new OpenAIProvider({ apiKey: "test-key" });

    it("throws when the completion was truncated", async () => {
      stub({ choices: [{ finish_reason: "length", message: { content: '{"overall_score": 4, "sum' } }] });
      await assert.rejects(() => provider().analyze(PNG, "p", "desktop"), /truncated/i);
    });

    it("throws when the model refused", async () => {
      stub({ choices: [{ finish_reason: "stop", message: { refusal: "I can't help with that." } }] });
      await assert.rejects(() => provider().analyze(PNG, "p", "desktop"), /refused/i);
    });

    it("throws when content is empty", async () => {
      stub({ choices: [{ finish_reason: "stop", message: { content: "" } }] });
      await assert.rejects(() => provider().analyze(PNG, "p", "desktop"), /no usable content/i);
    });

    // OpenAI-compatible endpoints for thinking models (Moonshot/Kimi, DeepSeek,
    // vLLM) leave `content` empty and put the answer in `reasoning_content`.
    // MotionLint reaches these through OPENAI_BASE_URL.
    it("falls back to reasoning_content when content is empty", async () => {
      stub({ choices: [{ finish_reason: "stop", message: { content: "", reasoning_content: CLEAN } }] });
      const result = await provider().analyze(PNG, "p", "desktop");
      assert.equal(result.overall_score, 7);
    });
  });

  describe("google", () => {
    const provider = () => new GoogleProvider({ apiKey: "test-key" });

    it("throws when the prompt was safety-blocked", async () => {
      stub({ promptFeedback: { blockReason: "SAFETY" } });
      await assert.rejects(() => provider().analyze(PNG, "p", "desktop"), /blocked/i);
    });

    it("throws when generation stopped early", async () => {
      stub({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"overall_score": 4' }] } }] });
      await assert.rejects(() => provider().analyze(PNG, "p", "desktop"), /stopped generating early/i);
    });

    it("still parses a well-formed response", async () => {
      stub({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: CLEAN }] } }] });
      const result = await provider().analyze(PNG, "p", "desktop");
      assert.equal(result.overall_score, 7);
    });
  });
});
