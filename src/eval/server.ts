import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export interface EvalServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Tiny static server for eval fixtures.
 * Maps:
 *   /eval/_base.css         → fixturesDir/_base.css
 *   /eval/<name>            → fixturesDir/<name>.html
 *   /eval/<name>.html       → fixturesDir/<name>.html
 */
export async function startEvalServer(fixturesDir: string, requestedPort = 0): Promise<EvalServer> {
  const root = resolve(fixturesDir);

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let p = url.pathname;
      if (!p.startsWith("/eval/")) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      let rel = p.slice("/eval/".length);
      if (!rel) rel = "index.html";
      if (!extname(rel) && rel !== "_base.css") rel += ".html";
      const filePath = resolve(join(root, rel));
      if (!filePath.startsWith(root)) {
        res.writeHead(403); res.end("forbidden"); return;
      }
      const st = await stat(filePath).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end(`not found: ${rel}`);
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, {
        "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(data);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((err as Error).message));
    }
  });

  await new Promise<void>((resolveListen) => server.listen(requestedPort, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : requestedPort;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}
