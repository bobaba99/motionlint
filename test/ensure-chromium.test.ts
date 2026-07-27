import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import playwright from "playwright";
import { launchChromium, isInteractive } from "../src/capture/ensure_chromium.js";

// The missing-browser message Playwright actually throws (from
// playwright-core .../registry/index.js). launchChromium keys off this text —
// there is no error code or class to match on.
const MISSING = new Error(
  "Executable doesn't exist at /home/user/.cache/ms-playwright/chromium-1234/chrome-linux/chrome\n" +
    "Looks like Playwright was just installed or updated.\n" +
    "Please run the following command to download new browsers:\n\n" +
    "    npx playwright install\n",
);

// Save/restore the TTY + CI signals isInteractive() reads, so these tests are
// deterministic regardless of how the suite itself is run.
const saved = {
  stdinTTY: process.stdin.isTTY,
  stdoutTTY: process.stdout.isTTY,
  CI: process.env.CI,
};

function setEnv({ tty, ci }: { tty: boolean; ci: boolean }): void {
  Object.defineProperty(process.stdin, "isTTY", { value: tty, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
  if (ci) process.env.CI = "1";
  else delete process.env.CI;
}

describe("launchChromium", () => {
  afterEach(() => {
    mock.restoreAll();
    Object.defineProperty(process.stdin, "isTTY", { value: saved.stdinTTY, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: saved.stdoutTTY, configurable: true });
    if (saved.CI === undefined) delete process.env.CI;
    else process.env.CI = saved.CI;
  });

  it("returns the browser directly when launch succeeds", async () => {
    const fake = { closed: false } as unknown as Awaited<ReturnType<typeof playwright.chromium.launch>>;
    mock.method(playwright.chromium, "launch", async () => fake);
    const browser = await launchChromium();
    assert.equal(browser, fake);
  });

  it("rethrows errors unrelated to a missing browser, unchanged", async () => {
    const boom = new Error("Target page, context or browser has been closed");
    mock.method(playwright.chromium, "launch", async () => {
      throw boom;
    });
    await assert.rejects(() => launchChromium(), /has been closed/);
  });

  it("in CI, fails loudly with the exact install command instead of prompting", async () => {
    setEnv({ tty: false, ci: true });
    const launch = mock.method(playwright.chromium, "launch", async () => {
      throw MISSING;
    });
    await assert.rejects(() => launchChromium(), /npx playwright install chromium/);
    // Must not retry — one failed launch, then a thrown error, no install attempt.
    assert.equal(launch.mock.callCount(), 1);
  });

  it("when piped (no TTY), also fails loudly rather than hanging on a prompt", async () => {
    setEnv({ tty: false, ci: false });
    mock.method(playwright.chromium, "launch", async () => {
      throw MISSING;
    });
    await assert.rejects(() => launchChromium(), /Chromium is not installed/);
  });
});

describe("isInteractive", () => {
  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: saved.stdinTTY, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: saved.stdoutTTY, configurable: true });
    if (saved.CI === undefined) delete process.env.CI;
    else process.env.CI = saved.CI;
  });

  it("is false in CI even with a TTY on both ends", () => {
    setEnv({ tty: true, ci: true });
    assert.equal(isInteractive(), false);
  });

  it("is false when either stream is not a TTY", () => {
    setEnv({ tty: false, ci: false });
    assert.equal(isInteractive(), false);
  });

  it("is true on a TTY outside CI", () => {
    setEnv({ tty: true, ci: false });
    assert.equal(isInteractive(), true);
  });
});
