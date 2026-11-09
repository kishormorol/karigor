import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { allows } from "../lib/access.js";
import type { Env } from "./env.js";
import { keyFor, type KeyInfo } from "./keys.js";

/**
 * The key calling, which must be allowed `permission` (from src/lib/access.ts).
 * Start every handler that is not public with `const key = await need(c, "...")`.
 */
export async function need(c: Context<Env>, permission: string): Promise<KeyInfo> {
  const key = await keyFor(c.req.header("authorization"), c.var.db);
  if (!key) throw new HTTPException(401, { message: "an access key is needed: Authorization: Bearer key_…" });
  c.set("keyId", key.id);
  if (!allows(key.scope, permission)) throw new HTTPException(403, { message: `this key may not ${permission}` });
  return key;
}
