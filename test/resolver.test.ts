import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveProvider } from "../src/providers/resolver.js";

// Providers read availability from the environment: ollama probes OLLAMA_HOST,
// the cloud providers check their API-key env vars. Pin all four per test so
// resolution is deterministic regardless of the machine running the suite.
const ENV_KEYS = ["OLLAMA_HOST", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"];

describe("provider resolver", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    // Unreachable port: ollama is deterministically unavailable.
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("auto mode forwards the configured model to the resolved provider", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const provider = await resolveProvider({ model: "claude-custom-test" });
    assert.equal(provider.name, "anthropic");
    assert.equal(provider.model, "claude-custom-test");
  });

  it("an explicitly requested provider receives the configured model", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const provider = await resolveProvider({ provider: "anthropic", model: "claude-custom-test" });
    assert.equal(provider.name, "anthropic");
    assert.equal(provider.model, "claude-custom-test");
  });

  it("auto mode falls back to the mock provider when nothing is available", async () => {
    const provider = await resolveProvider({ model: "claude-custom-test" });
    assert.equal(provider.name, "mock");
  });
});
