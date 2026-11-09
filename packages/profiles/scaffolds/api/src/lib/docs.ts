import { SERVICE } from "./service.js";

/**
 * Every endpoint the service answers, described for the people who will call it.
 * `/docs` and `/openapi.json` are made from this list, and `pnpm lint` and the tests fail
 * when a route in src/app.ts is missing here (or listed here but missing there).
 */
export interface Endpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** As written in src/app.ts, e.g. `/v1/orders/:id`. */
  path: string;
  summary: string;
  /** The permission from src/lib/access.ts a key needs; omit for an endpoint anyone may call. */
  permission?: string;
  /** An example request body, for POST, PUT and PATCH. */
  body?: unknown;
  /** An example of a successful answer. */
  example: unknown;
  /** The status of a successful answer (default 200). */
  status?: number;
}

export const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/health", summary: "Whether the service is up.", example: { ok: true } },
  { method: "GET", path: "/v1/me", summary: "The key making the call: its name and what it may do.", permission: "read data", example: { name: "Shop app", scope: "full" } },
  { method: "GET", path: "/v1/keys", summary: "Every key, active or turned off (the keys themselves are never shown again).", permission: "manage keys", example: { keys: [{ id: "3f1c…", name: "Shop app", preview: "key_Ab3d", scope: "full", active: true, createdAt: 1767225600000, lastUsedAt: null }] } },
  { method: "POST", path: "/v1/keys", summary: "Make a key for another program. The answer is the only time the key is shown.", permission: "manage keys", body: { name: "Rina's phone", scope: "read" }, example: { key: "key_…", id: "3f1c…", name: "Rina's phone", scope: "read" }, status: 201 },
  { method: "DELETE", path: "/v1/keys/:id", summary: "Turn a key off. It stops working at once.", permission: "manage keys", example: { ok: true } },
];

/** Hono's `:id` as OpenAPI's `{id}`. */
export const openapiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

export function openapi(serverUrl?: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const params = [...e.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    (paths[openapiPath(e.path)] ??= {})[e.method.toLowerCase()] = {
      summary: e.summary,
      ...(e.permission ? { security: [{ key: [] }], description: `Needs a key allowed to ${e.permission}.` } : { security: [] }),
      ...(params.length ? { parameters: params } : {}),
      ...(e.body !== undefined ? { requestBody: { required: true, content: { "application/json": { example: e.body } } } } : {}),
      responses: {
        [String(e.status ?? 200)]: { description: "Done", content: { "application/json": { example: e.example } } },
        ...(e.permission ? { "401": { description: "No key, or a key that is turned off" }, "403": { description: "The key may not do this" } } : {}),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: SERVICE.name, description: SERVICE.tagline, version: "1" },
    ...(serverUrl ? { servers: [{ url: serverUrl }] } : {}),
    components: { securitySchemes: { key: { type: "http", scheme: "bearer", description: "An access key: Authorization: Bearer key_…" } } },
    paths,
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const json = (v: unknown) => esc(JSON.stringify(v, null, 2));

/** A page a person (or the programmer they hire) can read: every endpoint with an example call. */
export function docsPage(base: string): string {
  const items = ENDPOINTS.map((e) => {
    const auth = e.permission ? ` \\\n  -H "Authorization: Bearer $KEY"` : "";
    const body = e.body !== undefined ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(e.body)}'` : "";
    return `<section><h2><span class="m">${e.method}</span> <code>${esc(e.path)}</code></h2>
<p>${esc(e.summary)}${e.permission ? ` <em>Needs a key allowed to ${esc(e.permission)}.</em>` : ""}</p>
<pre>curl -X ${e.method} ${esc(base)}${esc(e.path)}${auth}${esc(body)}</pre>
<p>Answer (${e.status ?? 200}):</p><pre>${json(e.example)}</pre></section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SERVICE.name)}: how to use it</title>
<style>:root{color-scheme:light dark;--fg:#1c1b19;--bg:#faf8f4;--mut:#6b675f;--line:#e4dfd5;--code:#f1ede5}@media (prefers-color-scheme:dark){:root{--fg:#ece8e1;--bg:#191816;--mut:#a39e94;--line:#34312c;--code:#24221f}}
body{font:16px/1.55 system-ui,sans-serif;color:var(--fg);background:var(--bg);margin:0}main{max-width:52rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-size:1.6rem;margin:.2rem 0}h2{font-size:1.05rem;margin:2rem 0 .4rem}.m{font:600 .8rem ui-monospace,monospace;padding:.15rem .4rem;border:1px solid var(--line);border-radius:4px}
p{margin:.4rem 0}.lead{color:var(--mut)}pre{background:var(--code);padding:.75rem;border-radius:6px;overflow-x:auto;font-size:.85rem}code{font-family:ui-monospace,monospace}section{border-top:1px solid var(--line)}</style></head>
<body><main><h1>${esc(SERVICE.name)}</h1><p class="lead">${esc(SERVICE.tagline)}</p>
<p>Every call except <code>/health</code> needs an access key, sent as <code>Authorization: Bearer key_…</code>. Answers are JSON; a problem is <code>{"error": "…"}</code> with a 4xx status. The same list for tools: <a href="/openapi.json">/openapi.json</a>.</p>
${items}</main></body></html>`;
}
