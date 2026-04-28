import { chromium, type Browser, type BrowserContext } from "playwright";
import type { AuthConfig, Viewport } from "../types.js";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
}

export interface BrowserSessionOptions {
  viewport: Viewport;
  videoDir?: string;
  record?: boolean;
  auth?: AuthConfig;
}

export async function launchBrowserSession(opts: BrowserSessionOptions): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: opts.viewport.width, height: opts.viewport.height },
    deviceScaleFactor: 2,
    recordVideo: opts.record && opts.videoDir
      ? { dir: opts.videoDir, size: { width: opts.viewport.width, height: opts.viewport.height } }
      : undefined,
  });

  if (opts.auth?.cookies?.length) {
    await context.addCookies(opts.auth.cookies);
  }

  return {
    browser,
    context,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
