/** Serves dist/ on PORT with clean URLs (/about → about.html) and 404.html for anything missing. */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { ROOT } from "./pages.mjs";

const DIST = join(ROOT, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".pdf": "application/pdf", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };

function find(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const base = join(DIST, clean);
  if (!base.startsWith(DIST)) return undefined;
  for (const c of [base, `${base}.html`, join(base, "index.html")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return undefined;
}

const server = createServer((req, res) => {
  const file = find(req.url ?? "/");
  const status = file ? 200 : 404;
  const body = file ?? (existsSync(join(DIST, "404.html")) ? join(DIST, "404.html") : undefined);
  res.writeHead(status, { "content-type": body ? (TYPES[extname(body)] ?? "application/octet-stream") : "text/plain", "x-content-type-options": "nosniff" });
  res.end(body ? readFileSync(body) : "Not found");
});
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`serving dist/ on http://localhost:${port}`));
