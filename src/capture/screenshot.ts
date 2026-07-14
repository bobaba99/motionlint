import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { CaptureOptions, CaptureResult, InteractionStep, Viewport } from "../types.js";
import { launchBrowserSession } from "./browser.js";
import { captureDomSnapshot, type DomSnapshot } from "./dom.js";

function slug(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

function urlSlug(url: string): string {
  try {
    const u = new URL(url);
    const path = (u.pathname + u.search).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "root";
    return `${u.hostname.replace(/[^a-z0-9]+/gi, "-")}-${path}`.toLowerCase();
  } catch {
    return slug(url);
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function applyLocalStorage(
  page: import("playwright").Page,
  origin: string,
  data: Record<string, string>,
): Promise<void> {
  await page.addInitScript(({ origin: o, data: d }) => {
    if (typeof window !== "undefined" && window.location.origin === o) {
      for (const [k, v] of Object.entries(d)) {
        try { window.localStorage.setItem(k, v as string); } catch { /* ignore */ }
      }
    }
  }, { origin, data });
}

async function runInteraction(page: import("playwright").Page, step: InteractionStep): Promise<void> {
  switch (step.action) {
    case "click":
      if (step.selector) await page.click(step.selector, { timeout: 5_000 });
      break;
    case "hover":
      if (step.selector) await page.hover(step.selector, { timeout: 5_000 });
      break;
    case "type":
      if (step.selector && step.value !== undefined) {
        await page.fill(step.selector, step.value, { timeout: 5_000 });
      }
      break;
    case "scroll":
      await page.evaluate((y) => window.scrollBy(0, y), Number(step.value ?? 600));
      break;
    case "wait":
      await page.waitForTimeout(step.ms ?? 500);
      break;
  }
}

export async function captureScreenshot(opts: CaptureOptions): Promise<CaptureResult> {
  const session = await launchBrowserSession({
    viewport: opts.viewport,
    record: opts.record,
    videoDir: opts.videoDir,
    auth: opts.auth,
  });

  const page = await session.context.newPage();

  try {
    if (opts.auth?.localStorage) {
      try {
        const origin = new URL(opts.url).origin;
        await applyLocalStorage(page, origin, opts.auth.localStorage);
      } catch {
        /* invalid url — skip */
      }
    }

    if (opts.auth?.beforeNavigate) {
      await page.addInitScript(opts.auth.beforeNavigate);
    }

    await page.goto(opts.url, {
      waitUntil: (opts.waitFor === "networkidle" ? "networkidle" : "load"),
      timeout: opts.waitTimeout ?? 15_000,
    });

    if (opts.waitFor && opts.waitFor !== "networkidle" && opts.waitFor !== "load") {
      try {
        await page.waitForSelector(opts.waitFor, { timeout: opts.waitTimeout ?? 10_000 });
      } catch {
        /* selector did not appear — continue */
      }
    }

    if (opts.interactions?.length) {
      for (const step of opts.interactions) {
        await runInteraction(page, step);
      }
      await page.waitForTimeout(300);
    }

    let dom: DomSnapshot | undefined;
    if (opts.withDom) {
      try {
        dom = await captureDomSnapshot(page);
      } catch {
        /* the snapshot is an enhancement, never a capture failure */
      }
    }

    const fullPage = opts.fullPage ?? true;
    const screenshot = await page.screenshot({ type: "png", fullPage });

    let screenshotPath: string | undefined;
    if (opts.screenshotDir) {
      await ensureDir(opts.screenshotDir);
      const fname = `${urlSlug(opts.url)}-${opts.viewport.name}-${Date.now()}.png`;
      screenshotPath = join(opts.screenshotDir, fname);
      await ensureDir(dirname(screenshotPath));
      await writeFile(screenshotPath, screenshot);
    }

    let videoPath: string | undefined;
    if (opts.record && opts.videoDir) {
      const v = page.video();
      if (v) {
        try {
          videoPath = await v.path();
        } catch {
          /* ignore */
        }
      }
    }

    await page.close();

    return {
      url: opts.url,
      viewport: opts.viewport,
      screenshot,
      screenshotPath,
      videoPath,
      fullPage,
      timestamp: new Date().toISOString(),
      ...(dom ? { dom } : {}),
    };
  } finally {
    await session.close();
  }
}

export async function captureMany(
  url: string,
  viewports: Viewport[],
  base: Omit<CaptureOptions, "url" | "viewport">,
): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];
  for (const viewport of viewports) {
    const result = await captureScreenshot({ ...base, url, viewport });
    results.push(result);
  }
  return results;
}
