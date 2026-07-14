import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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

/**
 * Applies the page-level auth hooks (localStorage seeding, beforeNavigate
 * script) that cookies alone don't cover. Must run before page.goto — both
 * hooks install init scripts. Cookie auth is applied at context creation.
 */
export async function applyPageAuth(page: Page, url: string, auth: AuthConfig | undefined): Promise<void> {
  if (auth?.localStorage) {
    try {
      const origin = new URL(url).origin;
      await page.addInitScript(({ origin: o, data: d }) => {
        if (typeof window !== "undefined" && window.location.origin === o) {
          for (const [k, v] of Object.entries(d)) {
            try { window.localStorage.setItem(k, v as string); } catch { /* ignore */ }
          }
        }
      }, { origin, data: auth.localStorage });
    } catch {
      /* invalid url — skip */
    }
  }
  if (auth?.beforeNavigate) {
    await page.addInitScript(auth.beforeNavigate);
  }
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
