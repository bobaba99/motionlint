/**
 * Route auto-discovery for `review --discover-routes`.
 *
 * Two sources, merged and deduped:
 *  - the site's /sitemap.xml (including one level of sitemap-index children),
 *  - a Next.js app directory (`app/` or `src/app/`) in the working directory.
 *
 * Discovery is best-effort: a missing sitemap or absent app directory simply
 * contributes nothing. Dynamic segments (`[slug]`), parallel routes (`@slot`)
 * and private folders (`_lib`) are skipped — we can't guess their params.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface SitemapParse {
  /** Same-origin page pathnames, e.g. "/pricing". */
  pages: string[];
  /** Child sitemap URLs (from a sitemap index). */
  sitemaps: string[];
}

const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

function pathnameIfSameOrigin(loc: string, origin: string): string | null {
  try {
    const u = new URL(loc);
    if (u.origin !== origin) return null;
    return u.pathname || "/";
  } catch {
    return null;
  }
}

/** Pull page paths and child-sitemap URLs out of a sitemap / sitemap-index document. */
export function parseSitemapXml(xml: string, origin: string): SitemapParse {
  const pages: string[] = [];
  const sitemaps: string[] = [];
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  for (const match of xml.matchAll(LOC_RE)) {
    const loc = match[1];
    if (isIndex) {
      sitemaps.push(loc);
    } else {
      const path = pathnameIfSameOrigin(loc, origin);
      if (path) pages.push(path);
    }
  }
  return { pages, sitemaps };
}

export interface SitemapDiscoveryOptions {
  /** Max child sitemaps to follow from a sitemap index. */
  maxChildSitemaps?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Injection point for tests. */
  fetchImpl?: typeof fetch;
}

async function fetchText(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Fetch <origin>/sitemap.xml and return same-origin page paths. Best-effort: failures → []. */
export async function discoverRoutesFromSitemap(baseUrl: string, opts: SitemapDiscoveryOptions = {}): Promise<string[]> {
  const { maxChildSitemaps = 5, timeoutMs = 5000, fetchImpl = fetch } = opts;
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const xml = await fetchText(`${origin}/sitemap.xml`, timeoutMs, fetchImpl);
  if (!xml) return [];

  const parsed = parseSitemapXml(xml, origin);
  const pages = [...parsed.pages];
  for (const child of parsed.sitemaps.slice(0, maxChildSitemaps)) {
    const childXml = await fetchText(child, timeoutMs, fetchImpl);
    if (!childXml) continue;
    pages.push(...parseSitemapXml(childXml, origin).pages);
  }
  return pages;
}

const PAGE_FILE_RE = /^page\.(tsx|ts|jsx|js|mdx)$/;

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function isSkippedSegment(segment: string): boolean {
  return segment.startsWith("[") || segment.startsWith("@") || segment.startsWith("_");
}

async function walkAppDir(dir: string, segments: string[], out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.isFile() && PAGE_FILE_RE.test(e.name))) {
    const path = segments.filter((s) => !isRouteGroup(s)).join("/");
    out.push(`/${path}`.replace(/\/+/g, "/"));
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isSkippedSegment(entry.name)) continue;
    await walkAppDir(join(dir, entry.name), [...segments, entry.name], out);
  }
}

/** Scan a Next.js app directory (`app/` or `src/app/`) under cwd for static routes. */
export async function discoverNextAppRoutes(cwd: string): Promise<string[]> {
  for (const candidate of [join(cwd, "app"), join(cwd, "src", "app")]) {
    const out: string[] = [];
    await walkAppDir(candidate, [], out);
    if (out.length > 0) return out;
  }
  return [];
}

export interface DiscoverRoutesOptions {
  url: string;
  cwd?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}

/** Merge sitemap + Next.js app-dir discovery: deduped, "/" first, capped. */
export async function discoverRoutes(opts: DiscoverRoutesOptions): Promise<string[]> {
  const limit = opts.limit ?? 20;
  const [sitemap, nextApp] = await Promise.all([
    discoverRoutesFromSitemap(opts.url, { fetchImpl: opts.fetchImpl }),
    discoverNextAppRoutes(opts.cwd ?? process.cwd()),
  ]);
  const unique = [...new Set([...sitemap, ...nextApp])];
  unique.sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  return unique.slice(0, limit);
}
