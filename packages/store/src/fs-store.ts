import { mkdir, readFile, readdir, appendFile, writeFile, stat, truncate } from "node:fs/promises";
import { join } from "node:path";
import { parseArtifact, serializeArtifact } from "./format.js";
import { gitCommitter, noopCommitter, type Committer } from "./git.js";
import { replay, type ProjectState } from "./replay.js";
import {
  EventSchema,
  type Artifact,
  type ArtifactKind,
  type ArtifactOf,
  type Event,
  type NewEvent,
} from "./schemas/index.js";

export class StoreError extends Error {
  override name = "StoreError";
}

/** The last line of events.jsonl is incomplete: a write was interrupted. `open` repairs it. */
export class TornTailError extends StoreError {
  override name = "TornTailError";
  constructor(message: string, readonly goodBytes: number) {
    super(message);
  }
}

export interface StoreOptions {
  committer?: Committer;
  clock?: () => Date;
}

/**
 * One project on disk:
 *   <dir>/events.jsonl                 append-only, source of truth
 *   <dir>/artifacts/<kind>/<id>.md     JSON frontmatter + Markdown body
 */
export class FsStore {
  private constructor(
    readonly dir: string,
    readonly projectId: string,
    private readonly committer: Committer,
    private readonly clock: () => Date,
    private nextSeq: number,
  ) {}

  static async create(root: string, projectId: string, opts: StoreOptions = {}): Promise<FsStore> {
    const dir = join(root, projectId);
    const committer = opts.committer ?? gitCommitter;
    await mkdir(join(dir, "artifacts"), { recursive: true });
    await writeFile(join(dir, "events.jsonl"), "", { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "EEXIST") throw new StoreError(`project ${projectId} already exists at ${dir}`);
      throw e;
    });
    await committer.init(dir);
    return new FsStore(dir, projectId, committer, opts.clock ?? (() => new Date()), 0);
  }

  static async open(root: string, projectId: string, opts: StoreOptions = {}): Promise<FsStore> {
    const dir = join(root, projectId);
    await stat(join(dir, "events.jsonl")).catch(() => {
      throw new StoreError(`no project ${projectId} at ${dir}`);
    });
    const store = new FsStore(dir, projectId, opts.committer ?? gitCommitter, opts.clock ?? (() => new Date()), 0);
    let events: Event[];
    try {
      events = await store.readEvents();
    } catch (e) {
      if (!(e instanceof TornTailError)) throw e;
      // A crash mid-write left a partial last line. Drop it; the event was never acknowledged.
      await truncate(join(dir, "events.jsonl"), e.goodBytes);
      events = await store.readEvents();
    }
    store.nextSeq = events.length === 0 ? 0 : events[events.length - 1]!.seq + 1;
    return store;
  }

  /** A store that never touches git; for tests and dry runs. */
  static async createEphemeral(root: string, projectId: string, clock?: () => Date): Promise<FsStore> {
    return FsStore.create(root, projectId, clock ? { committer: noopCommitter, clock } : { committer: noopCommitter });
  }

  // ---- artifacts ---------------------------------------------------------

  private artifactPath(kind: ArtifactKind, id: string): string {
    return join(this.dir, "artifacts", kind, `${id}.md`);
  }

  async writeArtifact(a: Artifact): Promise<void> {
    const p = this.artifactPath(a.meta.kind, a.meta.id);
    await mkdir(join(this.dir, "artifacts", a.meta.kind), { recursive: true });
    await writeFile(p, serializeArtifact(a), "utf8");
  }

  async readArtifact<K extends ArtifactKind>(kind: K, id: string): Promise<ArtifactOf<K>> {
    const text = await readFile(this.artifactPath(kind, id), "utf8").catch(() => {
      throw new StoreError(`no ${kind} artifact ${id}`);
    });
    const a = parseArtifact(text);
    if (a.meta.kind !== kind) throw new StoreError(`artifact ${id} is a ${a.meta.kind}, not a ${kind}`);
    return a as ArtifactOf<K>;
  }

  async listArtifacts(kind: ArtifactKind): Promise<string[]> {
    const names = await readdir(join(this.dir, "artifacts", kind)).catch(() => [] as string[]);
    return names.filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)).sort();
  }

  // ---- events ------------------------------------------------------------

  /** Append one event, assigning `seq` and `at`. Returns the stored event. */
  async appendEvent(e: NewEvent): Promise<Event> {
    const [full] = await this.appendEvents([e]);
    return full!;
  }

  /**
   * Append several events in one write. Either all of them land or (on a torn write) none are
   * acknowledged, so callers can treat a batch as one atomic fact.
   */
  async appendEvents(batch: NewEvent[]): Promise<Event[]> {
    if (batch.length === 0) return [];
    const at = this.clock().toISOString();
    const full = batch.map((e, i) => EventSchema.parse({ ...e, seq: this.nextSeq + i, at: e.at ?? at }));
    await appendFile(join(this.dir, "events.jsonl"), full.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf8");
    this.nextSeq += full.length;
    return full;
  }

  async readEvents(): Promise<Event[]> {
    const text = await readFile(join(this.dir, "events.jsonl"), "utf8");
    const lines = text.split("\n");
    const events: Event[] = [];
    lines.forEach((line, i) => {
      if (line === "" && i === lines.length - 1) return; // trailing newline
      if (line === "") throw new StoreError(`events.jsonl line ${i + 1} is empty`);
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        if (i === lines.length - 1) {
          const goodBytes = Buffer.byteLength(lines.slice(0, i).join("\n") + (i > 0 ? "\n" : ""), "utf8");
          throw new TornTailError(`events.jsonl line ${i + 1} is an interrupted write`, goodBytes);
        }
        throw new StoreError(`events.jsonl line ${i + 1} is not valid JSON`);
      }
      const r = EventSchema.safeParse(raw);
      if (!r.success) throw new StoreError(`events.jsonl line ${i + 1} is not a valid event: ${r.error.message}`);
      events.push(r.data);
    });
    return events;
  }

  async replay(): Promise<ProjectState> {
    return replay(this.projectId, await this.readEvents());
  }

  /** Snapshot the project directory. Call after a batch of writes. */
  async commit(message: string): Promise<void> {
    await this.committer.commit(this.dir, message);
  }
}
