import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db as defaultDb, type Db } from "./db/index.js";
import { isScope, SCOPES } from "./lib/access.js";
import { docsPage, openapi } from "./lib/docs.js";
import { BadRequest, body } from "./lib/validate.js";
import { need } from "./server/auth.js";
import type { Env } from "./server/env.js";
import { createKey, listKeys, revokeKey } from "./server/keys.js";
import { logRequest } from "./server/log.js";
import { ownerAuthorized, ownerKey } from "./server/owner-key.js";

/** The service's own public address: SITE_URL when a deploy target set it, else where the call came to. */
const base = (url: string) => (process.env.SITE_URL || new URL(url).origin).replace(/\/$/, "");

/**
 * The whole service. Handlers read the database as `c.var.db` and pass it to every database
 * function, so tests can give each test its own (`createApp(await testDb())`).
 * Add each new route to ENDPOINTS in src/lib/docs.ts too.
 */
export function createApp(database: Db = defaultDb) {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.set("db", database);
    await next();
  });

  // Other websites' pages may call the service from a browser; the key is what protects data.
  app.use("/v1/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));

  app.use("/v1/*", async (c, next) => {
    const t = performance.now();
    await next();
    await logRequest({ ...(c.var.keyId ? { keyId: c.var.keyId } : {}), method: c.req.method, path: c.req.path, status: c.res.status, ms: performance.now() - t }, c.var.db);
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: "something went wrong on our side" }, 500);
  });
  app.notFound((c) => c.json({ error: `nothing at ${c.req.method} ${c.req.path}; see /docs` }, 404));

  // Public. Keep /health cheap and independent of the database: deployments use it to know the service is up.
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/", (c) => c.redirect("/docs"));
  app.get("/docs", (c) => c.html(docsPage(base(c.req.url))));
  app.get("/openapi.json", (c) => c.json(openapi(base(c.req.url))));

  // Karigor asks here for the owner's first key (src/server/owner-key.ts). Not listed in the docs on purpose.
  app.post("/owner-key", async (c) => {
    if (!ownerAuthorized(c.req.header("authorization"))) return c.json({ error: "not allowed" }, 401);
    const r = await ownerKey(await c.req.json().catch(() => ({})), c.var.db);
    return c.json(r, "error" in r ? 400 : 200);
  });

  app.get("/v1/me", async (c) => {
    const key = await need(c, "read data");
    return c.json({ name: key.name, scope: key.scope });
  });

  app.get("/v1/keys", async (c) => {
    await need(c, "manage keys");
    return c.json({ keys: await listKeys(c.var.db) });
  });

  app.post("/v1/keys", async (c) => {
    await need(c, "manage keys");
    const b = await body(c, z.object({ name: z.string().trim().min(1).max(100), scope: z.string().default("full") }));
    if (!isScope(b.scope)) throw new BadRequest(`scope must be one of: ${Object.keys(SCOPES).join(", ")}`);
    const r = await createKey(b.name, b.scope, c.var.db);
    return c.json({ key: r.key, id: r.info.id, name: r.info.name, scope: r.info.scope }, 201);
  });

  app.delete("/v1/keys/:id", async (c) => {
    const key = await need(c, "manage keys");
    const id = c.req.param("id");
    if (id === key.id) throw new BadRequest("a key cannot turn itself off; use another key");
    if (!(await revokeKey(id, c.var.db))) return c.json({ error: "no such key" }, 404);
    return c.json({ ok: true });
  });

  return app;
}

export const app = createApp();

// Vercel serves this file's default export.
export default app;
