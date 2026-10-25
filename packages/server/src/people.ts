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
}

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
  async add(name: string): Promise<{ person: Person; token: string }> {
    const token = randomBytes(24).toString("hex");
    const person: Person = { id: randomBytes(6).toString("hex"), name, tokenHash: hash(token), projects: [], createdAt: new Date().toISOString() };
    await this.change((people) => people.push(person));
    return { person, token };
  }

  async byToken(token: string): Promise<Person | undefined> {
    const h = Buffer.from(hash(token));
    return (await this.all()).find((p) => {
      const x = Buffer.from(p.tokenHash);
      return x.length === h.length && timingSafeEqual(x, h);
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.change((people) => {
      const i = people.findIndex((p) => p.id === id);
      if (i >= 0) people.splice(i, 1);
      return i >= 0;
    });
  }

  async own(personId: string, projectId: string): Promise<void> {
    await this.change((people) => people.find((p) => p.id === personId)?.projects.push(projectId));
  }
}
