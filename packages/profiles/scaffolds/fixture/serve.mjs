import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
if (existsSync("start-fail")) { console.error("Error: could not start"); process.exit(1); }
const port = Number(process.env.PORT ?? 3000);
createServer((req, res) => {
  if (req.url === "/health") {
    // `needs-setting` names environment variables the app cannot work without.
    const needs = existsSync("needs-setting") ? readFileSync("needs-setting", "utf8").split(/\s+/).filter(Boolean) : [];
    const ok = !existsSync("health-fail") && needs.every((n) => process.env[n]);
    res.writeHead(ok ? 200 : 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: ok ? "ok" : "broken" }));
    return;
  }
  if (req.url === "/boom") {
    console.error(`Error: boom at request ${Date.now()}`);
    res.writeHead(500).end("boom");
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`fixture app: ${existsSync("src") ? readdirSync("src").sort().join(", ") : ""}\n`);
}).listen(port, "127.0.0.1", () => console.log(`listening on ${port}`));
