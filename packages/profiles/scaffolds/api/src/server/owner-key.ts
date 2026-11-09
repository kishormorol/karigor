import { timingSafeEqual } from "node:crypto";
import { db as defaultDb, type Db } from "../db/index.js";
import { createKey } from "./keys.js";

/**
 * Karigor's way to give the owner their first key once the service is hosted and it cannot reach the
 * database itself: it holds OWNER_LINK_SECRET and asks here. Without the secret set, this is switched off.
 */
export function ownerAuthorized(authorization: string | null | undefined, secret: string | undefined = process.env.OWNER_LINK_SECRET): boolean {
  if (!secret || !authorization) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authorization);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function ownerKey(input: { name?: unknown }, database: Db = defaultDb): Promise<{ key: string; name: string } | { error: string }> {
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Owner";
  const r = await createKey(name, "full", database);
  return { key: r.key, name: r.info.name };
}
