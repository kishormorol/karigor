/**
 * Signing in and checking who may do what, for pages, layouts and server actions.
 * Every private page calls requireUser() or requirePermission(); every server action starts with requireAction().
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/access";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session-cookie";
import { attemptLogin, endSession, findSession, type Person } from "./people";

export type { Person } from "./people";

/** Netlify's header, then the first x-forwarded-for entry, then "unknown". */
export function clientIp(h: Pick<Headers, "get">): string {
  return h.get("x-nf-client-connection-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** True when the Origin header (if any) names this site. A missing Origin is allowed (plain GETs, non-browser calls). */
export function originAllowed(origin: string | null, host: string | null, siteUrl: string | undefined = process.env.SITE_URL): boolean {
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (host && originHost === host) return true;
  try {
    return !!siteUrl && new URL(siteUrl).host === originHost;
  } catch {
    return false;
  }
}

/** This site's own address, for links people are sent: SITE_URL when set, else the address this request came to. */
export async function siteOrigin(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The signed-in person, or undefined. */
export async function currentUser(): Promise<Person | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const found = await findSession(token);
  if (!found) return undefined;
  if (found.refreshed && token) {
    try {
      jar.set(SESSION_COOKIE, token, sessionCookieOptions());
    } catch {
      // Cookies cannot be written while a page renders; the middleware keeps the browser's copy fresh.
    }
  }
  return found.person;
}

/** The signed-in person, or a trip to the login page. */
export async function requireUser(): Promise<Person> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: signed in and allowed, or the "not for your role" page. */
export async function requirePermission(permission: Permission): Promise<Person> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/denied");
  return user;
}

export class NotAllowedError extends Error {
  override name = "NotAllowedError";
}

/** The first line of every server action: same site, signed in, and (when given) allowed. */
export async function requireAction(permission?: Permission): Promise<Person> {
  const h = await headers();
  if (!originAllowed(h.get("origin"), h.get("x-forwarded-host") ?? h.get("host"))) throw new NotAllowedError("Cross-site request refused");
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !can(user, permission)) throw new NotAllowedError("Your role cannot do this.");
  return user;
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await attemptLogin({ email, password, ip: clientIp(await headers()) });
  if (!r.ok) return { ok: false, error: r.reason === "throttled" ? "Too many tries. Wait 15 minutes, then try again." : "That email and password do not match." };
  (await cookies()).set(SESSION_COOKIE, r.token, sessionCookieOptions());
  return { ok: true };
}

/** Starts a session for someone who just set their password from a link. */
export async function startSession(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await endSession(token);
  jar.delete(SESSION_COOKIE);
}
