/**
 * People, sign-in, sessions, links and the activity log, as plain database functions: no cookies,
 * no Next.js, so they are easy to test and the scripts and browser journeys can use them too.
 * Pages and server actions use src/server/auth.ts, which wraps these.
 */
import { and, asc, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { accessLinks, activity, loginAttempts, sessions, users } from "@/db/schema";
import { ADMIN_ROLE, isRole, roleLabel, type Role } from "@/lib/access";
import { dummyHash, hashPassword, hashToken, newToken, passwordProblem, verifyPassword } from "./passwords";

export type Db = typeof defaultDb;

export const MAX_FAILURES = 5;
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const LINK_MS = { invite: 7 * DAY_MS, reset: DAY_MS } as const;

export interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  /** False until they open their invitation and choose a password. */
  hasPassword: boolean;
}

type UserRow = typeof users.$inferSelect;
const person = (u: UserRow): Person => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, hasPassword: u.passwordHash !== null });

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export class PeopleError extends Error {
  override name = "PeopleError";
}

// ---- the activity log ----------------------------------------------------------

/** Record what someone did, in plain past-tense words ("booked a visit for Rina Akter"). */
export async function logActivity(userId: string | null, action: string, subject: string | null = null, database: Db = defaultDb, now = Date.now()): Promise<void> {
  await database.insert(activity).values({ id: crypto.randomUUID(), userId, action, subject, at: now });
}

export async function listActivity(database: Db = defaultDb, limit = 500) {
  const rows = await database.select({ id: activity.id, action: activity.action, subject: activity.subject, at: activity.at, who: users.name }).from(activity).leftJoin(users, eq(users.id, activity.userId)).orderBy(desc(activity.at)).limit(limit);
  return rows.map((r) => ({ ...r, who: r.who ?? "System" }));
}

// ---- people --------------------------------------------------------------------

export async function listPeople(database: Db = defaultDb): Promise<Person[]> {
  return (await database.select().from(users).orderBy(asc(users.name))).map(person);
}

export async function findPerson(id: string, database: Db = defaultDb): Promise<Person | undefined> {
  const [u] = await database.select().from(users).where(eq(users.id, id));
  return u ? person(u) : undefined;
}

async function activeAdmins(database: Db, except?: string): Promise<number> {
  const rows = await database.select({ id: users.id }).from(users).where(and(eq(users.role, ADMIN_ROLE), eq(users.active, true), except ? ne(users.id, except) : undefined));
  return rows.length;
}

/** Add someone with no password yet; they choose one from the invitation link this returns. */
export async function invitePerson(input: { name: string; email: string; role: string }, by: string | null, database: Db = defaultDb, now = Date.now()): Promise<{ person: Person; token: string }> {
  const name = input.name.trim();
  const email = normaliseEmail(input.email);
  if (!name) throw new PeopleError("Enter their name.");
  if (!looksLikeEmail(email)) throw new PeopleError("Enter an email address like name@example.com.");
  if (!isRole(input.role)) throw new PeopleError("Choose a role.");
  const [existing] = await database.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new PeopleError("Someone with this email is already here.");
  const id = crypto.randomUUID();
  await database.insert(users).values({ id, name, email, role: input.role, passwordHash: null, active: true, createdAt: now, updatedAt: now });
  const token = await createLink(id, "invite", by, database, now);
  await logActivity(by, `invited ${name} as ${roleLabel(input.role)}`, "people", database, now);
  return { person: (await findPerson(id, database))!, token };
}

/** The first admin, made from the command line (scripts/admin-link.ts). Refuses once anyone exists with that email. */
export async function ensureAdmin(input: { name: string; email: string }, database: Db = defaultDb, now = Date.now()): Promise<{ person: Person; token: string; created: boolean }> {
  const email = normaliseEmail(input.email);
  const [u] = await database.select().from(users).where(eq(users.email, email));
  if (u) {
    if (u.role !== ADMIN_ROLE || !u.active) {
      await database.update(users).set({ role: ADMIN_ROLE, active: true, updatedAt: now }).where(eq(users.id, u.id));
      await logActivity(null, `made ${u.name} an admin from the command line`, "people", database, now);
    }
    return { person: (await findPerson(u.id, database))!, token: await createLink(u.id, u.passwordHash ? "reset" : "invite", null, database, now), created: false };
  }
  const r = await invitePerson({ name: input.name || email.split("@")[0]!, email, role: ADMIN_ROLE }, null, database, now);
  return { ...r, created: true };
}

/** Change someone's role. Nobody changes their own, and the last active admin stays an admin. */
export async function changeRole(id: string, role: string, by: string, database: Db = defaultDb, now = Date.now()): Promise<void> {
  if (!isRole(role)) throw new PeopleError("Choose a role.");
  if (id === by) throw new PeopleError("You cannot change your own role. Ask another admin.");
  const p = await findPerson(id, database);
  if (!p) throw new PeopleError("That person is not here any more.");
  if (p.role === role) return;
  if (p.role === ADMIN_ROLE && p.active && (await activeAdmins(database, id)) === 0) throw new PeopleError("They are the last admin. Make someone else an admin first.");
  await database.update(users).set({ role, updatedAt: now }).where(eq(users.id, id));
  await logActivity(by, `changed ${p.name} from ${roleLabel(p.role)} to ${roleLabel(role as Role)}`, "people", database, now);
}

/** Turn someone's access off (they are signed out everywhere) or back on. */
export async function setActive(id: string, active: boolean, by: string, database: Db = defaultDb, now = Date.now()): Promise<void> {
  if (id === by && !active) throw new PeopleError("You cannot turn off your own access.");
  const p = await findPerson(id, database);
  if (!p) throw new PeopleError("That person is not here any more.");
  if (p.active === active) return;
  if (!active && p.role === ADMIN_ROLE && (await activeAdmins(database, id)) === 0) throw new PeopleError("They are the last admin. Make someone else an admin first.");
  await database.update(users).set({ active, updatedAt: now }).where(eq(users.id, id));
  if (!active) await database.delete(sessions).where(eq(sessions.userId, id));
  await logActivity(by, `${active ? "turned on" : "turned off"} access for ${p.name}`, "people", database, now);
}

// ---- one-time links ------------------------------------------------------------

/** A new invitation or reset link for someone; earlier unused links for them stop working. Returns the token. */
export async function createLink(userId: string, purpose: "invite" | "reset", by: string | null, database: Db = defaultDb, now = Date.now()): Promise<string> {
  await database.update(accessLinks).set({ usedAt: now }).where(and(eq(accessLinks.userId, userId), isNull(accessLinks.usedAt)));
  const token = newToken();
  await database.insert(accessLinks).values({ tokenHash: hashToken(token), userId, purpose, createdAt: now, expiresAt: now + LINK_MS[purpose], usedAt: null, createdBy: by });
  return token;
}

/** Who a link is for, while it can still be used. */
export async function peekLink(token: string, database: Db = defaultDb, now = Date.now()): Promise<{ person: Person; purpose: "invite" | "reset" } | undefined> {
  const [l] = await database.select().from(accessLinks).where(and(eq(accessLinks.tokenHash, hashToken(token)), isNull(accessLinks.usedAt), gt(accessLinks.expiresAt, now)));
  if (!l) return undefined;
  const p = await findPerson(l.userId, database);
  return p && p.active ? { person: p, purpose: l.purpose } : undefined;
}

/** Set the password from a link (once), and sign them in. */
export async function redeemLink(token: string, password: string, again: string, database: Db = defaultDb, now = Date.now()): Promise<{ ok: true; session: { token: string; expiresAt: number }; person: Person } | { ok: false; error: string }> {
  const found = await peekLink(token, database, now);
  if (!found) return { ok: false, error: "This link has been used or has expired. Ask an admin for a new one." };
  const problem = passwordProblem(password, again);
  if (problem) return { ok: false, error: problem };
  await database.update(accessLinks).set({ usedAt: now }).where(eq(accessLinks.tokenHash, hashToken(token)));
  await database.update(users).set({ passwordHash: await hashPassword(password), updatedAt: now }).where(eq(users.id, found.person.id));
  await database.delete(sessions).where(eq(sessions.userId, found.person.id));
  await logActivity(found.person.id, found.purpose === "invite" ? "joined" : "set a new password", "people", database, now);
  return { ok: true, session: await createSession(found.person.id, database, now), person: (await findPerson(found.person.id, database))! };
}

// ---- sign-in and sessions ------------------------------------------------------

export const throttleKey = (email: string, ip: string) => `${normaliseEmail(email)}|${ip}`;

export async function attemptLogin(input: { email: string; password: string; ip: string }, database: Db = defaultDb, now = Date.now()): Promise<{ ok: true; token: string; expiresAt: number; person: Person } | { ok: false; reason: "invalid" | "throttled" }> {
  const email = normaliseEmail(input.email ?? "");
  const key = throttleKey(email, input.ip);
  const [attempt] = await database.select().from(loginAttempts).where(eq(loginAttempts.key, key));
  const inWindow = !!attempt && now - attempt.windowStart < THROTTLE_WINDOW_MS;
  if (inWindow && attempt.failures >= MAX_FAILURES) return { ok: false, reason: "throttled" };

  const [u] = email ? await database.select().from(users).where(eq(users.email, email)) : [];
  const good = await verifyPassword(input.password ?? "", u?.passwordHash ?? (await dummyHash()));
  if (!u || !u.passwordHash || !good || !u.active) {
    if (inWindow) await database.update(loginAttempts).set({ failures: attempt.failures + 1 }).where(eq(loginAttempts.key, key));
    else await database.insert(loginAttempts).values({ key, failures: 1, windowStart: now }).onConflictDoUpdate({ target: loginAttempts.key, set: { failures: 1, windowStart: now } });
    return { ok: false, reason: "invalid" };
  }
  await database.delete(loginAttempts).where(eq(loginAttempts.key, key));
  return { ok: true, ...(await createSession(u.id, database, now)), person: person(u) };
}

export async function createSession(userId: string, database: Db = defaultDb, now = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const token = newToken();
  const expiresAt = now + SESSION_MS;
  await database.insert(sessions).values({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt, lastSeenAt: now });
  return { token, expiresAt };
}

/** The person behind a cookie value, or undefined. Expired sessions are removed; a day-old one slides forward. */
export async function findSession(token: string | undefined, database: Db = defaultDb, now = Date.now()): Promise<{ person: Person; refreshed: boolean } | undefined> {
  if (!token) return undefined;
  const tokenHash = hashToken(token);
  const [s] = await database.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
  if (!s) return undefined;
  if (s.expiresAt <= now) {
    await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return undefined;
  }
  const [u] = await database.select().from(users).where(eq(users.id, s.userId));
  if (!u || !u.active) return undefined;
  let refreshed = false;
  if (now - s.lastSeenAt > DAY_MS) {
    await database.update(sessions).set({ lastSeenAt: now, expiresAt: now + SESSION_MS }).where(eq(sessions.tokenHash, tokenHash));
    refreshed = true;
  }
  return { person: person(u), refreshed };
}

export async function endSession(token: string, database: Db = defaultDb): Promise<void> {
  await database.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
