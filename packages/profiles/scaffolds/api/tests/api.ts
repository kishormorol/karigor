import { createApp } from "../src/app.js";
import { createKey } from "../src/server/keys.js";
import type { Scope } from "../src/lib/access.js";
import { testDb } from "./db.js";

/**
 * A service on a fresh database, and a way to call it. `call` sends JSON and returns the status and
 * the answer. `keyFor("read")` makes a key of that scope to call with.
 */
export async function testApi() {
  const db = await testDb();
  const app = createApp(db);
  const call = async (method: string, path: string, opts: { key?: string; body?: unknown } = {}) => {
    const res = await app.request(path, {
      method,
      headers: { ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  const keyFor = async (scope: Scope = "full", name = "Test caller") => (await createKey(name, scope, db)).key;
  return { db, app, call, keyFor };
}
