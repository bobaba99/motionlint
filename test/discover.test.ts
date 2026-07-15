import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverNextAppRoutes,
  discoverRoutes,
  discoverRoutesFromSitemap,
  discoverStorybookStories,
  parseSitemapXml,
} from "../src/capture/discover.js";

const ORIGIN = "https://example.com";

function fakeFetch(routes: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = routes[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

describe("parseSitemapXml", () => {
  it("extracts same-origin page paths from a urlset", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/pricing</loc></url>
        <url><loc>https://other.com/evil</loc></url>
      </urlset>`;
    const parsed = parseSitemapXml(xml, ORIGIN);
    assert.deepEqual(parsed.pages, ["/", "/pricing"]);
    assert.deepEqual(parsed.sitemaps, []);
  });

  it("extracts child sitemap URLs from a sitemap index", () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
    </sitemapindex>`;
    const parsed = parseSitemapXml(xml, ORIGIN);
    assert.deepEqual(parsed.pages, []);
    assert.deepEqual(parsed.sitemaps, ["https://example.com/sitemap-pages.xml"]);
  });

  it("ignores malformed locs", () => {
    const xml = `<urlset><url><loc>not a url</loc></url></urlset>`;
    assert.deepEqual(parseSitemapXml(xml, ORIGIN).pages, []);
  });
});

describe("discoverRoutesFromSitemap", () => {
  it("follows one level of sitemap-index children", async () => {
    const fetchImpl = fakeFetch({
      [`${ORIGIN}/sitemap.xml`]: `<sitemapindex><sitemap><loc>${ORIGIN}/pages.xml</loc></sitemap></sitemapindex>`,
      [`${ORIGIN}/pages.xml`]: `<urlset><url><loc>${ORIGIN}/a</loc></url><url><loc>${ORIGIN}/b</loc></url></urlset>`,
    });
    const routes = await discoverRoutesFromSitemap(`${ORIGIN}/anything`, { fetchImpl });
    assert.deepEqual(routes, ["/a", "/b"]);
  });

  it("returns [] when the sitemap is missing", async () => {
    const routes = await discoverRoutesFromSitemap(ORIGIN, { fetchImpl: fakeFetch({}) });
    assert.deepEqual(routes, []);
  });
});

describe("discoverNextAppRoutes", () => {
  let dir: string;
  after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("maps the app directory to static routes, skipping dynamic/parallel/private segments", async () => {
    dir = await mkdtemp(join(tmpdir(), "ml-next-"));
    const mk = async (rel: string) => {
      await mkdir(join(dir, rel), { recursive: true });
      await writeFile(join(dir, rel, "page.tsx"), "export default () => null;");
    };
    await mk("app");
    await mk("app/pricing");
    await mk("app/(marketing)/about");
    await mk("app/blog/[slug]");
    await mk("app/@modal/photo");
    await mk("app/_internal/tools");

    const routes = await discoverNextAppRoutes(dir);
    assert.deepEqual(routes.sort(), ["/", "/about", "/pricing"]);
  });

  it("falls back to src/app and returns [] when neither exists", async () => {
    const empty = await mkdtemp(join(tmpdir(), "ml-next-empty-"));
    try {
      assert.deepEqual(await discoverNextAppRoutes(empty), []);
      await mkdir(join(empty, "src", "app", "dash"), { recursive: true });
      await writeFile(join(empty, "src", "app", "dash", "page.js"), "");
      assert.deepEqual(await discoverNextAppRoutes(empty), ["/dash"]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("discoverRoutes", () => {
  it("merges, dedupes, puts / first, and caps at the limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ml-merge-"));
    try {
      await mkdir(join(dir, "app", "pricing"), { recursive: true });
      await writeFile(join(dir, "app", "pricing", "page.tsx"), "");
      const fetchImpl = fakeFetch({
        [`${ORIGIN}/sitemap.xml`]: `<urlset>
          <url><loc>${ORIGIN}/pricing</loc></url>
          <url><loc>${ORIGIN}/</loc></url>
          <url><loc>${ORIGIN}/z</loc></url>
        </urlset>`,
      });
      const routes = await discoverRoutes({ url: ORIGIN, cwd: dir, limit: 2, fetchImpl });
      assert.deepEqual(routes, ["/", "/pricing"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("discoverStorybookStories", () => {
  const indexJson = {
    v: 5,
    entries: {
      "button--primary": { id: "button--primary", title: "Button", name: "Primary", type: "story" },
      "button--docs": { id: "button--docs", title: "Button", name: "Docs", type: "docs" },
      "card--default": { id: "card--default", title: "Card", name: "Default", type: "story" },
    },
  };
  const fetchOk = (async () => ({ ok: true, json: async () => indexJson })) as unknown as typeof fetch;

  it("returns iframe paths for story entries only, docs excluded", async () => {
    const stories = await discoverStorybookStories("http://localhost:6006", { fetchImpl: fetchOk });
    assert.deepEqual(stories, [
      "/iframe.html?id=button--primary&viewMode=story",
      "/iframe.html?id=card--default&viewMode=story",
    ]);
  });

  it("caps the list", async () => {
    const stories = await discoverStorybookStories("http://localhost:6006", { fetchImpl: fetchOk, limit: 1 });
    assert.equal(stories.length, 1);
  });

  it("returns [] on fetch failure or malformed payload", async () => {
    const fetch404 = (async () => ({ ok: false })) as unknown as typeof fetch;
    assert.deepEqual(await discoverStorybookStories("http://localhost:6006", { fetchImpl: fetch404 }), []);
    const fetchJunk = (async () => ({ ok: true, json: async () => ({ nope: 1 }) })) as unknown as typeof fetch;
    assert.deepEqual(await discoverStorybookStories("http://localhost:6006", { fetchImpl: fetchJunk }), []);
  });
});
