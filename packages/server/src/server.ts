import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FsStore } from "@karigor/store";
import { canStartMaintenance, correctAssumption, createProject, feedbackSignal, operateOnce, provideSettings, recordSignals, runOptions, runProject } from "@karigor/cli";
import { listProjects, projectView } from "./view.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Works from both `src/` (tests) and `dist/` (build). */
export const UI_FILE = join(here, "..", "ui", "index.html");

export interface ServerOptions {
  /** Where projects live. */
  root: string;
  /** Model adapter for every run: claude-code, claude, ollama or demo. */
  adapter: string;
  profile?: string;
  /** Deploy target for real runs: local, vercel or none. */
  deploy?: string;
  /** Port of the live app on the local target. */
  appPort?: number;
  /** When set, every API call must carry it (bearer header or the cookie set by `/?token=`). */
  token?: string;
  /** Builds running at once. */
  maxRuns?: number;
  log?: (line: string) => void;
}

export interface KarigorServer {
  server: Server;
  /** Projects with a build or fix round in progress. */
  runs: Map<string, Promise<void>>;
  /** Resolves when no run is in progress. */
  idle(): Promise<void>;
}

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "that message is too long");
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  try {
    const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof j !== "object" || j === null || Array.isArray(j)) throw new Error();
    return j as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "the request was not valid JSON");
  }
}

function text(b: Record<string, unknown>, key: string, max = 4000): string {
  const v = b[key];
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${key} is missing`);
  if (v.length > max) throw new HttpError(400, `${key} is too long (at most ${max} characters)`);
  return v.trim();
}

function optionalKey(b: Record<string, unknown>): string | undefined {
  const k = b["apiKey"];
  return typeof k === "string" && k.trim() ? k.trim() : undefined;
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}

/** The chat UI and its API over the kernel. Bring-your-own keys live only in the memory of the run they were sent with. */
export function createKarigorServer(o: ServerOptions): KarigorServer {
  const runs = new Map<string, Promise<void>>();
  const problems = new Map<string, string>();
  const log = o.log ?? (() => {});
  const flags = { adapter: o.adapter, profile: o.profile ?? "web-app", port: String(o.appPort ?? 3000), ...(o.deploy ? { deploy: o.deploy } : {}) };

  const startRun = (id: string, kind: "run" | "fix", apiKey?: string): boolean => {
    if (runs.has(id)) return false;
    if (runs.size >= (o.maxRuns ?? 2)) throw new HttpError(429, "Karigor is busy with other projects; try again in a few minutes");
    problems.delete(id);
    const p = (async () => {
      const opts = await runOptions(o.root, id, flags, { ...(apiKey ? { apiKey } : {}), log: (l) => log(`[${id}] ${l}`) });
      if (kind === "fix") await operateOnce(opts);
      else await runProject(opts);
    })()
      .catch((e: Error) => {
        // Kept for the page to show; a resume tries again.
        problems.set(id, e.message);
        log(`[${id}] stopped with an error: ${e.message}`);
      })
      .finally(() => runs.delete(id));
    runs.set(id, p);
    return true;
  };

  const view = async (id: string) => {
    const store = await FsStore.open(o.root, id).catch(() => {
      throw new HttpError(404, "no such project");
    });
    const v = await projectView(store, runs.has(id));
    const problem = problems.get(id);
    return problem ? { ...v, problem } : v;
  };

  const authed = (req: IncomingMessage): boolean => {
    if (!o.token) return true;
    const h = req.headers.authorization;
    const given = h?.startsWith("Bearer ") ? h.slice(7) : cookie(req, "karigor_token");
    return given !== undefined && same(given, o.token);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && (path === "/" || path === "/index.html")) {
      const t = url.searchParams.get("token");
      if (t !== null && o.token && same(t, o.token)) {
        res.writeHead(302, { location: "/", "set-cookie": `karigor_token=${encodeURIComponent(t)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, ...SECURITY_HEADERS });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
        "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        ...SECURITY_HEADERS,
      });
      res.end(await readFile(UI_FILE, "utf8"));
      return;
    }
    if (method === "GET" && path === "/healthz") return send(res, 200, { ok: true });
    if (!path.startsWith("/api/")) return send(res, 404, { error: "not found" });
    if (!authed(req)) return send(res, 401, { error: "this Karigor needs an access link; ask whoever runs it" });

    if (method === "GET" && path === "/api/config") {
      return send(res, 200, { adapter: o.adapter, demo: o.adapter === "demo", deploy: o.deploy ?? "local", needsKey: o.adapter === "claude" && !process.env["ANTHROPIC_API_KEY"] });
    }
    if (method === "GET" && path === "/api/projects") return send(res, 200, { projects: (await listProjects(o.root)).map((p) => ({ ...p, running: runs.has(p.id) })) });
    if (method === "POST" && path === "/api/projects") {
      const b = await body(req);
      const idea = text(b, "idea");
      if (o.adapter === "claude" && !process.env["ANTHROPIC_API_KEY"] && !optionalKey(b)) throw new HttpError(400, "this Karigor uses your own Anthropic key; add it first");
      const id = await createProject(o.root, idea);
      startRun(id, "run", optionalKey(b));
      return send(res, 201, { projectId: id });
    }

    const m = /^\/api\/projects\/([^/]+)(?:\/([a-z]+))?$/.exec(path);
    if (!m) return send(res, 404, { error: "not found" });
    const id = m[1]!;
    if (!ID.test(id)) throw new HttpError(404, "no such project");
    const action = m[2];

    if (method === "GET" && !action) return send(res, 200, await view(id));
    if (method === "GET" && action === "stream") {
      await view(id);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", ...SECURITY_HEADERS });
      let last = "";
      let busy = false;
      const push = async () => {
        if (busy) return;
        busy = true;
        try {
          const s = await stat(join(o.root, id, "events.jsonl"));
          const sig = `${s.size}:${s.mtimeMs}:${runs.has(id)}:${problems.get(id) ?? ""}`;
          if (sig !== last) {
            last = sig;
            res.write(`data: ${JSON.stringify(await view(id))}\n\n`);
          }
        } catch {
          /* the next tick tries again */
        } finally {
          busy = false;
        }
      };
      await push();
      const tick = setInterval(push, 1000);
      const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(tick);
        clearInterval(beat);
      });
      return;
    }
    if (method === "POST" && action === "resume") {
      const b = await body(req);
      await view(id);
      const started = startRun(id, "run", optionalKey(b));
      return send(res, 202, { started });
    }
    if (method === "POST" && action === "feedback") {
      const b = await body(req);
      const said = text(b, "text");
      const store = await FsStore.open(o.root, id).catch(() => {
        throw new HttpError(404, "no such project");
      });
      const [workItemId] = await recordSignals(store, [feedbackSignal(said)]);
      const fixing = !runs.has(id) && canStartMaintenance(await store.replay()) ? startRun(id, "fix", optionalKey(b)) : false;
      return send(res, 202, { workItemId: workItemId ?? null, fixing });
    }
    if (method === "POST" && action === "corrections") {
      const b = await body(req);
      const store = await FsStore.open(o.root, id).catch(() => {
        throw new HttpError(404, "no such project");
      });
      const r = await correctAssumption(store, text(b, "decisionId", 20), text(b, "text")).catch((e: Error) => {
        throw new HttpError(400, e.message);
      });
      const fixing = r.workItemId && !runs.has(id) && canStartMaintenance(await store.replay()) ? startRun(id, "fix", optionalKey(b)) : false;
      return send(res, 202, { ...r, fixing });
    }
    if (method === "POST" && action === "settings") {
      const b = await body(req);
      const raw = b["values"];
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new HttpError(400, "values is missing");
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string" && v.length <= 4000) values[k] = v;
      if (runs.has(id)) throw new HttpError(409, "it is being worked on right now; try again when this round finishes");
      const store = await FsStore.open(o.root, id).catch(() => {
        throw new HttpError(404, "no such project");
      });
      const opts = await runOptions(o.root, id, flags, { log: (l) => log(`[${id}] ${l}`) });
      if (!opts.deploy) throw new HttpError(400, "this Karigor does not put apps online, so there is nowhere to store settings");
      // Applying settings rebuilds the live app; it is tracked like a run so nothing else starts meanwhile.
      let result: Awaited<ReturnType<typeof provideSettings>> | undefined;
      const p = provideSettings({ store, deploy: opts.deploy, values, log: (l) => log(`[${id}] ${l}`) })
        .then((r) => {
          result = r;
        })
        .finally(() => runs.delete(id));
      runs.set(id, p.catch(() => {}));
      await p.catch((e: Error) => {
        throw new HttpError(400, e.message);
      });
      if (result!.resumed) startRun(id, "run");
      return send(res, 200, { stored: result!.stored, stillMissing: result!.stillMissing, url: result!.url ?? null, resumed: !!result!.resumed });
    }
    return send(res, 404, { error: "not found" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else {
        log(`error: ${e.stack ?? e.message}`);
        send(res, 500, { error: "something went wrong on the server" });
      }
    });
  });

  return {
    server,
    runs,
    idle: async () => {
      while (runs.size) await Promise.all([...runs.values()]);
    },
  };
}
