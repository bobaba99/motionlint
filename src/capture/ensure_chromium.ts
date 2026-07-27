import { chromium, type Browser, type LaunchOptions } from "playwright";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import kleur from "kleur";

/**
 * The exact command a user must run to get the browser. Named in every failure
 * message and used as the argv when we install on their behalf.
 */
const INSTALL_ARGS = ["playwright", "install", "chromium"] as const;
const INSTALL_COMMAND = `npx ${INSTALL_ARGS.join(" ")}`;

/**
 * Playwright throws a plain Error (no code, no class) when the browser binary is
 * missing — the only reliable discriminator is the message text. Matches both
 * the raw "Executable doesn't exist" and the boxed "playwright install" hint.
 */
function isMissingBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|playwright install/i.test(message);
}

/**
 * A real terminal on both ends, and not a CI runner. Auto-installing is only
 * safe to offer when someone is present to consent to a ~300MB download; in CI
 * or when piped, we must fail loudly instead of hanging on a prompt.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
}

async function confirmInstall(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (
      await rl.question(
        kleur.yellow(
          "Chromium isn't installed (~300MB, one-time). Install it now? [Y/n] ",
        ),
      )
    )
      .trim()
      .toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

/** Shell out to Playwright's own installer, inheriting stdio so its progress bar shows. */
function runInstall(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", [...INSTALL_ARGS], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`\`${INSTALL_COMMAND}\` exited with code ${code}`)),
    );
  });
}

/**
 * Launch Chromium, installing the browser on first run if it is missing.
 *
 * A drop-in for `chromium.launch(...)` — every capture path routes through here
 * so the install prompt is offered once regardless of which command the user
 * ran. On a TTY we ask, install, and retry; in CI or when piped we rethrow a
 * message naming the exact command so the failure stays scriptable and loud.
 * Errors unrelated to a missing browser propagate unchanged.
 */
export async function launchChromium(options: LaunchOptions = { headless: true }): Promise<Browser> {
  try {
    return await chromium.launch(options);
  } catch (err) {
    if (!isMissingBrowserError(err)) throw err;

    if (!isInteractive()) {
      throw new Error(
        `Chromium is not installed. Run:\n\n    ${INSTALL_COMMAND}\n\n` +
          "(MotionLint offers to install it automatically when run in an interactive terminal.)",
      );
    }

    if (!(await confirmInstall())) {
      throw new Error(`Chromium is required. Install it with:\n\n    ${INSTALL_COMMAND}`);
    }

    process.stderr.write(kleur.dim(`\n→ ${INSTALL_COMMAND}\n`));
    await runInstall();

    // Retry once. A second missing-browser failure here is genuine (install
    // reported success but the binary still isn't launchable), so let it surface.
    return chromium.launch(options);
  }
}
