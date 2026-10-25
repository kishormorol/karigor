import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalDeploy, startServer, type RunningServer } from "@karigor/deploy";
import { profileFor } from "@karigor/profiles";

/** Each project's live app gets its own port, kept in `apps.json` beside the projects. */
export class AppPorts {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string, private readonly first = 3100) {
    this.file = join(root, "apps.json");
  }

  async all(): Promise<Record<string, number>> {
    try {
      const j = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      return typeof j === "object" && j !== null && !Array.isArray(j) ? (j as Record<string, number>) : {};
    } catch {
      return {};
    }
  }

  portFor(id: string): Promise<number> {
    const next = this.queue.then(async () => {
      const ports = await this.all();
      if (ports[id]) return ports[id];
      const taken = new Set(Object.values(ports));
      let port = this.first;
      while (taken.has(port)) port++;
      ports[id] = port;
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(ports, null, 2));
      await rename(tmp, this.file);
      return port;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}

/** Keeps every project's live release running on its own port, and switches when a new release or new settings go live. */
export class LiveApps {
  private readonly running = new Map<string, { version: string; settings: string; server: RunningServer }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(private readonly o: { root: string; profile: string; ports: AppPorts; publicUrl?: string; log?: (line: string) => void }) {}

  /** One pass over every project: start what is live but not running, restart what changed, stop what went offline. */
  async check(): Promise<void> {
    const profile = profileFor(this.o.profile);
    const argv = profile.commands.start;
    if (!argv?.length) return;
    for (const [id, port] of Object.entries(await this.o.ports.all())) {
      const deploy = new LocalDeploy({ projectDir: join(this.o.root, id), profile, productionPort: port });
      const cur = await deploy.current().catch(() => undefined);
      const was = this.running.get(id);
      if (!cur) {
        if (was) {
          await was.server.stop();
          this.running.delete(id);
        }
        continue;
      }
      const env = { ...(await deploy.settingsEnv()), ...(this.o.publicUrl ? { SITE_URL: publicAppUrl(this.o.publicUrl, port) } : {}) };
      const settings = JSON.stringify(env);
      if (was && was.version === cur.version && was.settings === settings && was.server.alive) continue;
      await was?.server.stop();
      const server = startServer(argv, deploy.releaseDir(cur.version), port, env);
      this.running.set(id, { version: cur.version, settings, server });
      const h = await server.waitHealthy(profile.healthPath ?? "/", 120_000);
      this.o.log?.(`[${id}] ${h.ok ? `serving ${cur.version} on port ${port}` : `${cur.version} did not start: ${h.output.split("\n")[0]}`}`);
    }
  }

  start(everyMs = 15_000): void {
    const tick = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.check();
      } catch (e) {
        this.o.log?.(`keeping apps live: ${(e as Error).message}`);
      } finally {
        this.busy = false;
      }
    };
    void tick();
    this.timer = setInterval(tick, everyMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await Promise.all([...this.running.values()].map((r) => r.server.stop()));
    this.running.clear();
  }
}

/** The address people use for the app on `port`, from a template such as `https://a{port}.example.com`. */
export const publicAppUrl = (template: string, port: number) => template.replaceAll("{port}", String(port));
