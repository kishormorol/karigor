import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/passwords";
import { LINK_MS, MAX_FAILURES, PeopleError, SESSION_MS, attemptLogin, changeRole, createLink, ensureAdmin, findSession, invitePerson, listActivity, peekLink, redeemLink, setActive } from "@/server/people";
import { testDb } from "./db";

const T = 1_800_000_000_000;

async function joined(db: Awaited<ReturnType<typeof testDb>>, role: "admin" | "member", email: string, by: string | null = null) {
  const { person, token } = await invitePerson({ name: email.split("@")[0]!, email, role }, by, db, T);
  const r = await redeemLink(token, "password-1", "password-1", db, T);
  if (!r.ok) throw new Error(r.error);
  return person;
}

describe("passwords", () => {
  it("hashes with a salt and verifies only the right password", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^scrypt\$/);
    expect(await hashPassword("correct horse")).not.toBe(h);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(passwordProblem("short", "short")).toMatch(/at least 8/);
    expect(passwordProblem("long enough", "long enougj")).toMatch(/not the same/);
    expect(passwordProblem("long enough", "long enough")).toBeUndefined();
  });
});

describe("invitations and links", () => {
  it("an invited person has no password until they use their link, which works once", async () => {
    const db = await testDb();
    const { person, token } = await invitePerson({ name: "Rina", email: " Rina@Example.com ", role: "member" }, null, db, T);
    expect(person.email).toBe("rina@example.com");
    expect(person.hasPassword).toBe(false);
    expect((await attemptLogin({ email: "rina@example.com", password: "", ip: "1" }, db, T)).ok).toBe(false);
    expect((await peekLink(token, db, T))?.purpose).toBe("invite");
    expect(await redeemLink(token, "short", "short", db, T)).toEqual({ ok: false, error: "Use at least 8 characters." });
    const r = await redeemLink(token, "a-good-one", "a-good-one", db, T);
    expect(r.ok).toBe(true);
    expect((await redeemLink(token, "a-good-one", "a-good-one", db, T)).ok).toBe(false);
    expect((await attemptLogin({ email: "RINA@example.com", password: "a-good-one", ip: "1" }, db, T)).ok).toBe(true);
  });

  it("links expire, and a new link stops the old one working", async () => {
    const db = await testDb();
    const p = await joined(db, "member", "a@example.com");
    const old = await createLink(p.id, "reset", null, db, T);
    const fresh = await createLink(p.id, "reset", null, db, T + 1);
    expect(await peekLink(old, db, T + 2)).toBeUndefined();
    expect(await peekLink(fresh, db, T + 2)).toBeDefined();
    expect(await peekLink(fresh, db, T + 1 + LINK_MS.reset)).toBeUndefined();
  });

  it("refuses a duplicate email, a bad email, or an unknown role, in plain words", async () => {
    const db = await testDb();
    await joined(db, "member", "a@example.com");
    await expect(invitePerson({ name: "A", email: "A@example.com", role: "member" }, null, db, T)).rejects.toThrow(/already here/);
    await expect(invitePerson({ name: "B", email: "not-an-email", role: "member" }, null, db, T)).rejects.toThrow(/email address/);
    await expect(invitePerson({ name: "C", email: "c@example.com", role: "boss" }, null, db, T)).rejects.toThrow(PeopleError);
  });

  it("ensureAdmin makes the first admin, and on a second run gives a fresh link without a duplicate", async () => {
    const db = await testDb();
    const first = await ensureAdmin({ email: "owner@example.com", name: "Owner" }, db, T);
    expect(first.created).toBe(true);
    expect(first.person.role).toBe("admin");
    const again = await ensureAdmin({ email: "OWNER@example.com", name: "" }, db, T + 1);
    expect(again.created).toBe(false);
    expect(await peekLink(first.token, db, T + 2)).toBeUndefined();
    expect(await peekLink(again.token, db, T + 2)).toBeDefined();
  });
});

describe("signing in", () => {
  it("slows guessing: after five failures the right password waits", async () => {
    const db = await testDb();
    await joined(db, "member", "a@example.com");
    for (let i = 0; i < MAX_FAILURES; i++) expect(await attemptLogin({ email: "a@example.com", password: "nope", ip: "9" }, db, T)).toEqual({ ok: false, reason: "invalid" });
    expect(await attemptLogin({ email: "a@example.com", password: "password-1", ip: "9" }, db, T)).toEqual({ ok: false, reason: "throttled" });
    expect((await attemptLogin({ email: "a@example.com", password: "password-1", ip: "9" }, db, T + 16 * 60_000)).ok).toBe(true);
  });

  it("sessions end when they expire or when access is turned off", async () => {
    const db = await testDb();
    const admin = await joined(db, "admin", "boss@example.com");
    const m = await joined(db, "member", "m@example.com");
    const r = await attemptLogin({ email: "m@example.com", password: "password-1", ip: "1" }, db, T);
    if (!r.ok) throw new Error("no session");
    expect((await findSession(r.token, db, T + 1000))?.person.email).toBe("m@example.com");
    expect(await findSession(r.token, db, T + SESSION_MS + 1)).toBeUndefined();
    const r2 = await attemptLogin({ email: "m@example.com", password: "password-1", ip: "1" }, db, T);
    if (!r2.ok) throw new Error("no session");
    await setActive(m.id, false, admin.id, db, T);
    expect(await findSession(r2.token, db, T + 1)).toBeUndefined();
    expect((await attemptLogin({ email: "m@example.com", password: "password-1", ip: "1" }, db, T)).ok).toBe(false);
  });
});

describe("roles and access", () => {
  it("nobody changes their own role, and the last admin cannot be demoted or turned off", async () => {
    const db = await testDb();
    const a = await joined(db, "admin", "a@example.com");
    const b = await joined(db, "member", "b@example.com", a.id);
    await expect(changeRole(a.id, "member", a.id, db, T)).rejects.toThrow(/your own role/);
    await expect(setActive(a.id, false, a.id, db, T)).rejects.toThrow(/your own access/);
    await changeRole(b.id, "admin", a.id, db, T);
    await changeRole(a.id, "member", b.id, db, T);
    await expect(changeRole(b.id, "member", a.id, db, T)).rejects.toThrow(/your own role|last admin/);
    const log = await listActivity(db);
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["changed b from Member to Admin", "changed a from Admin to Member"]));
  });
});
