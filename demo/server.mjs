// Minimal static demo server for MotionLint E2E testing.
// Serves a multi-route TS animation showcase from demo/public/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "public");
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
};

const ROUTES = new Map([
  ["/",          "index.html"],
  ["/pricing",   "pricing.html"],
  ["/signup",    "signup.html"],
  ["/dashboard", "dashboard.html"],
  ["/loading",   "loading.html"],
  ["/cat",       "cat.html"],
]);

async function safeRead(path) {
  try {
    const st = await stat(path);
    if (!st.isFile()) return null;
    return await readFile(path);
  } catch { return null; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // route map → html file
  if (ROUTES.has(pathname)) pathname = `/${ROUTES.get(pathname)}`;

  // prevent path traversal
  const filePath = resolve(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("forbidden"); return;
  }

  const data = await safeRead(filePath);
  if (!data) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>404</title><h1>Not found</h1><p>${pathname}</p>`);
    return;
  }
  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(data);
});

server.listen(PORT, () => {
  console.log(`MotionLint demo running → http://localhost:${PORT}`);
  console.log(`Routes: ${[...ROUTES.keys()].join(", ")}`);
});
