import { timingSafeEqual } from "node:crypto";
import { db as defaultDb } from "@/db";
import { ensureAdmin, type Db } from "@/server/people";

/**
 * Karigor's way to give the app's owner their first sign-in when it cannot reach the database itself
 * (a hosted app): it holds OWNER_LINK_SECRET and asks here. Without the secret set, this is switched off.
 */
export function ownerLinkAuthorized(authorization: string | null, secret: string | undefined = process.env.OWNER_LINK_SECRET): boolean {
  if (!secret || !authorization) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authorization);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function ownerLink(input: { email?: unknown; name?: unknown }, origin: string, database: Db = defaultDb): Promise<{ link: string; created: boolean } | { error: string }> {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "an email address is needed" };
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const r = await ensureAdmin({ email, name }, database);
  return { link: `${origin.replace(/\/$/, "")}/welcome/${r.token}`, created: r.created };
}
