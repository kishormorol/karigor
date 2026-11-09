import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Someone with their own sign-in link. Only a hash of the link's secret is kept. */
export interface Person {
  id: string;
  name: string;
  tokenHash: string;
  /** Projects this person started; they see only these. */
  projects: string[];
  createdAt: string;
  /** Lower-case; set for people who sign in by email. */
  email?: string;
  /** Hashes of sign-ins on other devices (an email sign-in adds one), newest last. */
  sessions?: string[];
  /** A one-time email sign-in waiting to be used. */
  login?: { hash: string; expires: string };
  /** Model use this person may spend, in USD: the welcome credit plus what they bought. */
  creditUsd?: number;
  /** What their builds have used so far, in USD, margin included. Never goes down. */
  usedUsd?: number;
  /** Payment references already counted, so a payment notice sent twice adds credit once. */
  payments?: string[];
}

/** What a person can still spend, in USD. */
export const balanceOf = (p: Person) => Math.round(((p.creditUsd ?? 0) - (p.usedUsd ?? 0)) * 10000) / 10000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_MINUTES = 15;
const MAX_SESSIONS = 10;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** The people who may use this Karigor, kept in `people.json` beside the projects. */
export class People {
  private readonly file: string;
  /** Writes happen one after another, so two sign-ups never overwrite each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.file = join(root, "people.json");
  }

  async all(): Promise<Person[]> {
    try {
      const j = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      return Array.isArray(j) ? (j as Person[]) : [];
    } catch {
      return [];
    }
  }

  private change<T>(fn: (people: Person[]) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const people = await this.all();
      const out = fn(people);
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(people, null, 2), { mode: 0o600 });
      await rename(tmp, this.file);
      return out;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /** Adds someone and returns the secret of their sign-in link; it is shown once and never stored. */
  async add(name: string, extra: { email?: string; creditUsd?: number } = {}): Promise<{ person: Person; token: string }> {
    const token = randomBytes(24).toString("hex");
    const person: Person = { id: randomBytes(6).toString("hex"), name, tokenHash: hash(token), projects: [], createdAt: new Date().toISOString(), ...(extra.email ? { email: extra.email } : {}), ...(extra.creditUsd ? { creditUsd: extra.creditUsd } : {}) };
    await this.change((people) => people.push(person));
    return { person, token };
  }

  async byToken(token: string): Promise<Person | undefined> {
    const h = Buffer.from(hash(token));
    const same = (stored: string) => {
      const x = Buffer.from(stored);
      return x.length === h.length && timingSafeEqual(x, h);
    };
    return (await this.all()).find((p) => same(p.tokenHash) || (p.sessions ?? []).some(same));
  }

  async byId(id: string): Promise<Person | undefined> {
    return (await this.all()).find((p) => p.id === id);
  }

  /** Whoever started this project. */
  async ownerOf(projectId: string): Promise<Person | undefined> {
    return (await this.all()).find((p) => p.projects.includes(projectId));
  }

  /**
   * A one-time sign-in for an email address, valid 15 minutes. Someone new is added when `create` is
   * given (sign-ups are open), with the welcome credit. Returns the secret for the emailed link.
   */
  async startEmailLogin(email: string, create?: { creditUsd: number; max: number }): Promise<{ token: string; person: Person; created: boolean } | undefined> {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e) || e.length > 200) throw new Error("that does not look like an email address");
    const token = randomBytes(24).toString("hex");
    const login = { hash: hash(token), expires: new Date(Date.now() + LOGIN_MINUTES * 60_000).toISOString() };
    return this.change((people) => {
      let person = people.find((p) => p.email === e);
      let created = false;
      if (!person) {
        if (!create || people.length >= create.max) return undefined;
        person = { id: randomBytes(6).toString("hex"), name: e.split("@")[0]!.slice(0, 80), email: e, tokenHash: hash(randomBytes(24).toString("hex")), projects: [], createdAt: new Date().toISOString(), ...(create.creditUsd ? { creditUsd: create.creditUsd } : {}) };
        people.push(person);
        created = true;
      }
      person.login = login;
      return { token, person: { ...person }, created };
    });
  }

  /** Uses a one-time sign-in: returns a new session secret for this device, or undefined when it is wrong or old. */
  async finishEmailLogin(token: string): Promise<{ person: Person; session: string } | undefined> {
    const h = Buffer.from(hash(token));
    const session = randomBytes(24).toString("hex");
    return this.change((people) => {
      const person = people.find((p) => {
        if (!p.login) return false;
        const x = Buffer.from(p.login.hash);
        return x.length === h.length && timingSafeEqual(x, h);
      });
      if (!person || Date.parse(person.login!.expires) < Date.now()) return undefined;
      delete person.login;
      person.sessions = [...(person.sessions ?? []), hash(session)].slice(-MAX_SESSIONS);
      return { person: { ...person }, session };
    });
  }

  /** Adds bought credit once per payment reference. Returns false when that payment was already counted. */
  async addCredit(id: string, usd: number, ref: string): Promise<boolean> {
    if (!(usd > 0)) throw new Error("credit must be more than zero");
    return this.change((people) => {
      const p = people.find((x) => x.id === id);
      if (!p || (p.payments ?? []).includes(ref)) return false;
      p.creditUsd = Math.round(((p.creditUsd ?? 0) + usd) * 10000) / 10000;
      p.payments = [...(p.payments ?? []), ref];
      return true;
    });
  }

  /** Counts what a build used against its owner. */
  async charge(id: string, usd: number): Promise<void> {
    if (!(usd > 0)) return;
    await this.change((people) => {
      const p = people.find((x) => x.id === id);
      if (p) p.usedUsd = Math.round(((p.usedUsd ?? 0) + usd) * 10000) / 10000;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.change((people) => {
      const i = people.findIndex((p) => p.id === id);
      if (i >= 0) people.splice(i, 1);
      return i >= 0;
    });
  }

  /** A deleted project leaves everyone's list. */
  async disown(projectId: string): Promise<void> {
    await this.change((people) => {
      for (const p of people) p.projects = p.projects.filter((x) => x !== projectId);
    });
  }

  async own(personId: string, projectId: string): Promise<void> {
    await this.change((people) => people.find((p) => p.id === personId)?.projects.push(projectId));
  }
}
