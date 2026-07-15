import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../src/analysis/prompt.js";

describe("comparison prompt mode", () => {
  it("instructs the model to compare CURRENT vs BASELINE and report only differences", async () => {
    const prompt = await buildPrompt({
      viewportName: "desktop-vs-baseline",
      compare: { baselineUrl: "https://prod.example.com/" },
    });
    assert.match(prompt, /Comparison mode/);
    assert.match(prompt, /CURRENT/);
    assert.match(prompt, /BASELINE/);
    assert.match(prompt, /prod\.example\.com/);
    assert.match(prompt, /only differences/i);
  });
});

describe("scheme-pair prompt mode", () => {
  it("instructs the model to review color-scheme renderings side by side", async () => {
    const prompt = await buildPrompt({
      viewportName: "desktop-schemes",
      schemePair: { schemes: ["light", "dark"] },
    });
    assert.match(prompt, /Color-scheme/);
    assert.match(prompt, /light \/ dark/);
    assert.match(prompt, /prefers-color-scheme/);
  });
});
