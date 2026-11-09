import { createHash, randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { isScope, type Scope } from "../lib/access.js";

export interface KeyInfo {
  id: string;
  name: string;
  preview: string;
  scope: string;
  active: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/** Make a key. The key itself is returned once and never stored; keep only `info`. */
export async function createKey(name: string, scope: Scope = "full", database: Db = defaultDb): Promise<{ key: string; info: KeyInfo }> {
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new Error("a key needs a name saying who uses it");
  if (!isScope(scope)) throw new Error(`unknown scope "${scope}"`);
  const key = `key_${randomBytes(24).toString("base64url")}`;
  const info: KeyInfo = { id: crypto.randomUUID(), name: clean, preview: key.slice(0, 8), scope, active: true, createdAt: Date.now(), lastUsedAt: null };
  await database.insert(apiKeys).values({ ...info, keyHash: hash(key) });
  return { key, info };
}

/** The active key an `Authorization: Bearer <key>` header names, or undefined. Records when it was last used. */
export async function keyFor(authorization: string | undefined | null, database: Db = defaultDb): Promise<KeyInfo | undefined> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m) return undefined;
  const [row] = await database.select().from(apiKeys).where(eq(apiKeys.keyHash, hash(m[1]!))).limit(1);
  if (!row || !row.active) return undefined;
  const now = Date.now();
  // Only write when it changes by a minute or more, so busy keys do not write on every call.
  if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) await database.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id));
  const { keyHash: _, ...info } = row;
  return { ...info, lastUsedAt: now };
}

export async function listKeys(database: Db = defaultDb): Promise<KeyInfo[]> {
  const rows = await database.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  return rows.map(({ keyHash: _, ...info }) => info);
}

/** Turn a key off. It stops working at once; it is kept so the request log still names it. */
export async function revokeKey(id: string, database: Db = defaultDb): Promise<boolean> {
  const r = await database.update(apiKeys).set({ active: false }).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id });
  return r.length > 0;
}
