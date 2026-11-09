import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { meter } from "@karigor/budget";
import { FsStore, GivenError, GIVEN_LIMITS, addGiven, queueInbox, runningPid } from "@karigor/store";
import { adminLink, ownerAccessKey, phoneBuildFile, projectPhoneApps, canStartMaintenance, correctAssumption, editSignal, createProject, feedbackSignal, growOnce, ideaFor, isLang, type Lang, operateOnce, pausedForAllowance, provideSettings, recordSignals, runOptions, runProject, STARTERS, STARTERS_BN } from "@karigor/cli";
import { listProjects, projectView } from "./view.js";
import { errorIn } from "./errors.js";
import type { Mailer } from "./mail.js";
import type { PaymentProvider } from "./billing.js";
import { People, balanceOf, type Person } from "./people.js";
import { AppPorts, LiveApps, publicAppUrl } from "./apps.js";

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
  /** Let anyone open the page and make their own sign-in by giving a name. Off by default: links come from whoever runs it. */
  signup?: boolean;
  /** Most people a sign-up may create. */
  maxPeople?: number;
  /**
   * Host every project's live app from here, each on its own port, kept running and switched to
   * each new release. `url` is the address people use for it, with `{port}` in it, such as
   * `https://a{port}.example.com`; without it they get http://localhost:<port>.
   */
  apps?: { url?: string };
  /** Builds running at once. */
  maxRuns?: number;
  /**
   * Sign-in by email: a one-time link is sent to the address (`url` is this Karigor's public address).
   * With sign-ups open, a new address becomes a new person with `welcomeCreditUsd`.
   */
  emailSignIn?: { url: string; mailer: Mailer };
  welcomeCreditUsd?: number;
  /**
   * Charge people for builds that use this Karigor's own model key: what each build spent, plus
   * `marginPct`, comes off its owner's credit, and a build needs credit to start. A person's own key is never charged.
   */
  metered?: { marginPct: number };
  /** Buying credit: the providers people may pay with, and the amounts (USD) they may buy. */
  billing?: { providers: PaymentProvider[]; packs: number[] };
  /** How long a project paused for the usage allowance waits before trying again (default 30 minutes). */
  resumeEveryMs?: number;
  log?: (line: string) => void;
}

export interface KarigorServer {
  server: Server;
  /** Projects with a build or fix round in progress. */
  runs: Map<string, Promise<void>>;
  /** Resolves when no run is in progress. */
  idle(): Promise<void>;
  /** The live apps this server keeps running, when it hosts them. */
  live?: LiveApps;
}

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Who is asking: whoever runs this Karigor sees everything; everyone else only their own projects. */
type Viewer = { admin: true } | { admin: false; person: Person };
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

/** The body as text, for notices whose signature covers the exact bytes. */
async function rawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "that message is too long");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A file's raw bytes, refused once past `max`. */
async function bytes(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw new HttpError(413, "the file is too big (at most 10 MB)");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

function text(b: Record<string, unknown>, key: string, max = 4000): string {
  const v = b[key];
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${key} is missing`);
  if (v.length > max) throw new HttpError(400, `${key} is too long (at most ${max} characters)`);
  return v.trim();
}

function ideaForStarter(starter: string, changes: string | undefined, lang: Lang): string {
  if (changes && changes.length > 4000) throw new HttpError(400, "idea is too long (at most 4000 characters)");
  try {
    return ideaFor(changes, starter, lang);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

function optionalKey(b: Record<string, unknown>): string | undefined {
  const k = b["apiKey"];
  return typeof k === "string" && k.trim() ? k.trim() : undefined;
}

const signInCookie = (token: string) => `karigor_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`;

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** Errors are written in the page's language; the page names it in a header. */
function langOf(req: IncomingMessage): Lang {
  const h = req.headers["x-karigor-lang"];
  return isLang(h) ? h : "en";
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}

/** The chat UI and its API over the kernel. Bring-your-own keys live only in the memory of the run they were sent with. */
export function createKarigorServer(o: ServerOptions): KarigorServer {
  const runs = new Map<string, Promise<void>>();
  const log = o.log ?? (() => {});
  const people = new People(o.root);
  const ports = new AppPorts(o.root);
  const live = o.apps ? new LiveApps({ root: o.root, profile: o.profile ?? "web-app", ports, ...(o.apps.url ? { publicUrl: o.apps.url } : {}), log }) : undefined;
  /** Run flags for one project: when this server hosts the apps, each has its own port. */
  const flagsFor = async (id: string) => (o.apps ? { ...flags, port: String(await ports.portFor(id)) } : flags);
  /** Local addresses of hosted apps, written as the address people use. */
  const publicUrls = async <T>(v: T): Promise<T> => {
    if (!o.apps?.url) return v;
    const hosted = new Set(Object.values(await ports.all()));
    const json = JSON.stringify(v).replace(/http:\/\/(?:localhost|127\.0\.0\.1):(\d{2,5})\/?/g, (m, p: string) => (hosted.has(Number(p)) ? `${publicAppUrl(o.apps!.url!, Number(p))}/` : m));
    return JSON.parse(json) as T;
  };
  const problems = new Map<string, string>();
  const flags = { adapter: o.adapter, profile: o.profile ?? "web-app", port: String(o.appPort ?? 3000), ...(o.deploy ? { deploy: o.deploy } : {}) };

  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  const phoneJobs = new Map<string, Promise<void>>();
  const startRun = (id: string, kind: "run" | "fix" | "grow", apiKey?: string): boolean => {
    if (runs.has(id)) return false;
    clearTimeout(retries.get(id));
    retries.delete(id);
    if (runs.size >= (o.maxRuns ?? 2)) throw new HttpError(429, "Karigor is busy with other projects; try again in a few minutes");
    problems.delete(id);
    // What the project had spent before, so its owner is charged for this run alone.
    const before = o.metered && !apiKey ? spentOn(id) : undefined;
    const p = (async () => {
      const opts = await runOptions(o.root, id, await flagsFor(id), { ...(apiKey ? { apiKey } : {}), log: (l) => log(`[${id}] ${l}`) });
      if (kind === "fix") await operateOnce(opts);
      else if (kind === "grow") {
        const r = await growOnce(opts);
        if (!r.stage && r.why) problems.set(id, r.why);
      } else await runProject(opts);
    })()
      .catch((e: Error) => {
        // Kept for the page to show; a resume tries again.
        problems.set(id, e.message);
        log(`[${id}] stopped with an error: ${e.message}`);
      })
      .finally(async () => {
        if (before) await chargeFor(id, await before).catch((e: Error) => log(`[${id}] could not count what this run used: ${e.message}`));
        runs.delete(id);
        void retryIfPaused(id);
      });
    runs.set(id, p);
    return true;
  };

  /** What a project's builds have spent with the model, in USD. */
  const spentOn = async (id: string): Promise<number> => {
    const store = await FsStore.open(o.root, id);
    const state = await store.replay();
    if (!state.ledgerId) return 0;
    return meter((await store.readArtifact("cost-ledger", state.ledgerId)).meta).total;
  };
  /** The run's spending, with the margin, comes off its owner's credit. Projects of whoever runs this Karigor are not charged. */
  const chargeFor = async (id: string, before: number): Promise<void> => {
    const used = (await spentOn(id)) - before;
    const owner = await people.ownerOf(id);
    if (!owner || !(used > 0)) return;
    const usd = used * (1 + (o.metered?.marginPct ?? 0) / 100);
    await people.charge(owner.id, usd);
    log(`[${id}] charged ${owner.name} USD ${usd.toFixed(4)}`);
  };
  /** Whether a build may start for this viewer: always with their own key or unmetered; otherwise they need credit left. */
  const mayBuild = (v: Viewer, apiKey: string | undefined): boolean => !o.metered || !!apiKey || v.admin || balanceOf(v.person) > 0;
  const needCredit = (v: Viewer, apiKey: string | undefined): void => {
    if (!mayBuild(v, apiKey)) throw new HttpError(402, "your credit has run out; add credit to keep building");
  };

  /** A project paused for the usage allowance tries again on its own, on a fixed interval; the page shows it paused meanwhile. */
  const retryIfPaused = async (id: string): Promise<void> => {
    if (retries.has(id) || runs.has(id)) return;
    if (o.metered) {
      const owner = await people.ownerOf(id);
      if (owner && balanceOf(owner) <= 0) return;
    }
    const state = await FsStore.open(o.root, id).then((st) => st.replay()).catch(() => undefined);
    if (!state || !pausedForAllowance(state)) return;
    const t = setTimeout(() => {
      retries.delete(id);
      void (async () => {
        try {
          if (runs.has(id)) return;
          if (await busyElsewhere(id)) return void retryIfPaused(id);
          log(`[${id}] trying again after the usage allowance pause`);
          startRun(id, "run");
        } catch {
          void retryIfPaused(id); // busy with other projects: wait another round
        }
      })();
    }, o.resumeEveryMs ?? 30 * 60_000);
    t.unref?.();
    retries.set(id, t);
  };
  // Projects paused before this server started carry on too.
  void listProjects(o.root).then((ps) => Promise.all(ps.filter((p) => p.status === "waiting").map((p) => retryIfPaused(p.id)))).catch(() => {});

  /** Another process (karigor serve, a CLI run or resume) is working on it. */
  const busyElsewhere = async (id: string) => !runs.has(id) && (await runningPid(join(o.root, id))) !== undefined;
  const isRunning = async (id: string) => runs.has(id) || (await busyElsewhere(id));

  const view = async (id: string, lang?: string | null) => {
    const store = await FsStore.open(o.root, id).catch(() => {
      throw new HttpError(404, "no such project");
    });
    const v = await publicUrls(await projectView(store, await isRunning(id), isLang(lang) ? lang : "en"));
    const problem = problems.get(id);
    return problem ? { ...v, problem } : v;
  };

  /** The token's owner: the one who runs it (KARIGOR_TOKEN, or anyone when there is none) or a person with their own link. */
  const viewerFor = async (token: string | undefined | null): Promise<Viewer | undefined> => {
    if (!o.token) return { admin: true };
    if (!token) return undefined;
    if (same(token, o.token)) return { admin: true };
    const person = await people.byToken(token);
    return person ? { admin: false, person } : undefined;
  };
  const whoIs = (req: IncomingMessage) => {
    const h = req.headers.authorization;
    return viewerFor(h?.startsWith("Bearer ") ? h.slice(7) : cookie(req, "karigor_token"));
  };
  const sees = (v: Viewer, id: string) => v.admin || v.person.projects.includes(id);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && (path === "/" || path === "/index.html")) {
      // An emailed one-time sign-in: this device gets its own session, and the link stops working.
      const login = url.searchParams.get("login");
      if (login !== null && o.emailSignIn) {
        const done = await people.finishEmailLogin(login);
        res.writeHead(302, { location: done ? "/" : "/?expired=1", ...(done ? { "set-cookie": signInCookie(done.session) } : {}), ...SECURITY_HEADERS });
        res.end();
        return;
      }
      const t = url.searchParams.get("token");
      if (t !== null && o.token && (await viewerFor(t))) {
        res.writeHead(302, { location: "/", "set-cookie": signInCookie(t), ...SECURITY_HEADERS });
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
        "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src http: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        ...SECURITY_HEADERS,
      });
      res.end(await readFile(UI_FILE, "utf8"));
      return;
    }
    if (method === "GET" && path === "/healthz") return send(res, 200, { ok: true });
    // The web server in front asks before it gets a certificate for an app's address.
    if (method === "GET" && path === "/tls-ok") {
      const domain = url.searchParams.get("domain") ?? "";
      const known = o.apps?.url ? Object.values(await ports.all()).some((p) => new URL(publicAppUrl(o.apps!.url!, p)).hostname === domain) : false;
      return send(res, known ? 200 : 404, {});
    }
    if (!path.startsWith("/api/")) throw new HttpError(404, "not found");
    // A payment provider telling us a payment finished, or a payer's browser coming back. Credit is
    // added only for what the provider itself confirms, once per payment.
    const notice = /^\/api\/billing\/(notice|return)\/(paddle|sslcommerz)$/.exec(path);
    if (notice && (method === "POST" || method === "GET") && o.billing) {
      const provider = o.billing.providers.find((x) => x.name === notice[2]);
      if (!provider) throw new HttpError(404, "not found");
      const raw = method === "GET" ? url.search.slice(1) : await rawBody(req);
      const paid = await provider.confirm({ headers: req.headers, raw }).catch((e: Error) => {
        log(`payment notice from ${provider.name} could not be checked: ${e.message}`);
        return undefined;
      });
      if (paid) {
        const added = await people.addCredit(paid.personId, paid.usd, paid.ref).catch(() => false);
        if (added) log(`credit: USD ${paid.usd} for ${paid.personId} (${paid.ref})`);
      }
      if (notice[1] === "return") {
        res.writeHead(303, { location: paid ? "/?paid=1" : "/?paid=0", ...SECURITY_HEADERS });
        res.end();
        return;
      }
      return send(res, 200, { ok: true });
    }
    if (method === "POST" && path === "/api/signin/email") {
      // The same answer whether or not the address is known, so this cannot be used to find out who has an account.
      if (!o.emailSignIn || !o.token) throw new HttpError(404, "not found");
      const b = await body(req);
      const email = text(b, "email", 200);
      const lang = isLang(b["lang"]) ? b["lang"] : "en";
      let r;
      try {
        r = await people.startEmailLogin(email, o.signup ? { creditUsd: o.welcomeCreditUsd ?? 0, max: o.maxPeople ?? 200 } : undefined);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (r) {
        const link = `${o.emailSignIn.url.replace(/\/$/, "")}/?login=${r.token}`;
        const sent = await o.emailSignIn.mailer(r.person.email!, link, lang);
        if (!sent.ok) log(`sign-in email to ${r.person.email} failed: ${sent.output}`);
        if (r.created) log(`${r.person.email} signed up`);
      }
      return send(res, 200, { sent: true });
    }
    if (method === "POST" && path === "/api/signup") {
      if (!o.signup || !o.token) throw new HttpError(403, "this Karigor does not take sign-ups; ask whoever runs it for a link");
      const name = text(await body(req), "name", 80);
      if ((await people.all()).length >= (o.maxPeople ?? 200)) throw new HttpError(403, "this Karigor is full; ask whoever runs it for a link");
      const { person, token } = await people.add(name);
      log(`${person.name} signed up`);
      res.writeHead(201, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": signInCookie(token), ...SECURITY_HEADERS });
      res.end(JSON.stringify({ name: person.name, token }));
      return;
    }
    const viewer = await whoIs(req);
    if (!viewer) {
      const error = o.signup ? "sign up to start" : "this Karigor needs an access link; ask whoever runs it";
      return send(res, 401, { error: errorIn(langOf(req), error), signup: !!o.signup, ...(o.emailSignIn ? { email: true } : {}) });
    }

    if (path === "/api/billing" && method === "GET") {
      if (!o.billing) throw new HttpError(404, "not found");
      return send(res, 200, { packs: o.billing.packs, providers: o.billing.providers.map((x) => ({ name: x.name, label: x.label })), ...(viewer.admin ? {} : { creditUsd: balanceOf((await people.byId(viewer.person.id)) ?? viewer.person) }) });
    }
    if (path === "/api/billing/checkout" && method === "POST") {
      if (!o.billing) throw new HttpError(404, "not found");
      if (viewer.admin) throw new HttpError(400, "whoever runs this Karigor does not need credit");
      const b = await body(req);
      const usd = Number(b["usd"]);
      if (!o.billing.packs.includes(usd)) throw new HttpError(400, "choose one of the amounts shown");
      const provider = o.billing.providers.find((x) => x.name === b["provider"]);
      if (!provider) throw new HttpError(400, "choose a way to pay");
      try {
        const r = await provider.checkout({ personId: viewer.person.id, name: viewer.person.name, ...(viewer.person.email ? { email: viewer.person.email } : {}), usd, returnUrl: "/?paid=1" });
        return send(res, 200, { url: r.url });
      } catch (e) {
        log(`checkout with ${provider.name} failed: ${(e as Error).message}`);
        throw new HttpError(502, "the payment page could not be opened; try again in a minute");
      }
    }
    if (path === "/api/people" || path.startsWith("/api/people/")) {
      if (!viewer.admin) throw new HttpError(403, "only whoever runs this Karigor can add people");
      if (method === "GET" && path === "/api/people") {
        return send(res, 200, { people: (await people.all()).map((p) => ({ id: p.id, name: p.name, projects: p.projects.length, createdAt: p.createdAt })) });
      }
      if (method === "POST" && path === "/api/people") {
        if (!o.token) throw new HttpError(400, "people need their own links only when this Karigor has an access link (KARIGOR_TOKEN)");
        const { person, token } = await people.add(text(await body(req), "name", 80));
        return send(res, 201, { id: person.id, name: person.name, token });
      }
      const pm = /^\/api\/people\/([a-f0-9]{1,32})$/.exec(path);
      if (method === "DELETE" && pm) return send(res, (await people.remove(pm[1]!)) ? 200 : 404, {});
      throw new HttpError(404, "not found");
    }

    if (method === "GET" && path === "/api/config") {
      return send(res, 200, { adapter: o.adapter, demo: o.adapter === "demo", deploy: o.deploy ?? "local", needsKey: o.adapter === "claude" && !process.env["ANTHROPIC_API_KEY"], me: viewer.admin ? { admin: true, people: !!o.token } : { admin: false, name: viewer.person.name, ...(viewer.person.email ? { email: viewer.person.email } : {}), ...(o.metered ? { creditUsd: balanceOf(viewer.person) } : {}) }, ...(o.metered ? { metered: true } : {}) });
    }
    if (method === "GET" && path === "/api/projects") return send(res, 200, { projects: await Promise.all((await listProjects(o.root)).filter((p) => sees(viewer, p.id)).map(async (p) => ({ ...p, running: await isRunning(p.id) }))) });
    if (method === "GET" && path === "/api/starters") {
      return send(res, 200, { starters: STARTERS.map((s) => ({ id: s.id, title: s.title, for: s.for, idea: s.idea, basedOn: s.basedOn.map((x) => x.name), ...(STARTERS_BN[s.id] ? { bn: STARTERS_BN[s.id] } : {}) })) });
    }
    if (method === "POST" && path === "/api/projects") {
      const b = await body(req);
      // Their own idea, or a ready-made one with their changes in `idea`.
      const starter = typeof b["starter"] === "string" ? b["starter"] : undefined;
      const idea = starter === undefined ? text(b, "idea") : ideaForStarter(starter, typeof b["idea"] === "string" ? b["idea"] : undefined, isLang(b["lang"]) ? b["lang"] : "en");
      if (o.adapter === "claude" && !process.env["ANTHROPIC_API_KEY"] && !optionalKey(b)) throw new HttpError(400, "this Karigor uses your own Anthropic key; add it first");
      needCredit(viewer, optionalKey(b));
      const id = await createProject(o.root, idea);
      if (!viewer.admin) await people.own(viewer.person.id, id);
      // `hold`: the page adds the person's files first, then starts it with resume.
      if (b["hold"] !== true) startRun(id, "run", optionalKey(b));
      return send(res, 201, { projectId: id });
    }

    // A phone app the cloud build made, as a download.
    const pf = /^\/api\/projects\/([^/]+)\/phone\/(v\d+\/(?:android|ios)\/[A-Za-z0-9._-]+)$/.exec(path);
    if (method === "GET" && pf) {
      const pid = pf[1]!;
      if (!ID.test(pid) || !sees(viewer, pid)) throw new HttpError(404, "no such project");
      const file = await phoneBuildFile(join(o.root, pid), pf[2]!);
      if (!file) throw new HttpError(404, "not found");
      const data = await readFile(file);
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${pf[2]!.split("/").at(-1)}"`, "content-length": String(data.length), "cache-control": "no-store", ...SECURITY_HEADERS });
      res.end(data);
      return;
    }

    const m = /^\/api\/projects\/([^/]+)(?:\/([a-z]+))?$/.exec(path);
    if (!m) throw new HttpError(404, "not found");
    const id = m[1]!;
    if (!ID.test(id) || !sees(viewer, id)) throw new HttpError(404, "no such project");
    const action = m[2];

    const lang = url.searchParams.get("lang");
    if (method === "GET" && !action) return send(res, 200, await view(id, lang));
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
          const phone = await stat(join(o.root, id, "phone-apps.json")).then((x) => x.mtimeMs, () => 0);
          const sig = `${s.size}:${s.mtimeMs}:${await isRunning(id)}:${problems.get(id) ?? ""}:${phone}`;
          if (sig !== last) {
            last = sig;
            res.write(`data: ${JSON.stringify(await view(id, lang))}\n\n`);
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
      if (await busyElsewhere(id)) throw new HttpError(409, "it is already being worked on from another window or the command line");
      needCredit(viewer, optionalKey(b));
      const started = startRun(id, "run", optionalKey(b));
      return send(res, 202, { started });
    }
    if (method === "POST" && action === "grow") {
      const b = await body(req);
      const v = await view(id);
      if (!v.nextStage) throw new HttpError(409, v.status === "finished" ? "every part of the plan is built" : "it is not finished yet");
      if (await busyElsewhere(id)) throw new HttpError(409, "it is already being worked on from another window or the command line");
      needCredit(viewer, optionalKey(b));
      return send(res, 202, { started: startRun(id, "grow", optionalKey(b)), stage: v.nextStage.name });
    }
    if (method === "POST" && action === "feedback") {
      const b = await body(req);
      const said = text(b, "text");
      const store = await FsStore.open(o.root, id).catch(() => {
        throw new HttpError(404, "no such project");
      });
      if (runs.has(id) || (await runningPid(store.dir))) {
        // A build is working on it (here, or in karigor serve or a CLI run): the message waits in the inbox.
        await queueInbox(store.dir, { kind: b["edit"] === true ? "edit" : "feedback", text: said });
        return send(res, 202, { workItemId: null, fixing: false, queued: true });
      }
      // `edit`: a change made by pointing at the app in the preview, which takes the fast lane.
      const [workItemId] = await recordSignals(store, [b["edit"] === true ? editSignal(said) : feedbackSignal(said)]);
      const fixing = !runs.has(id) && canStartMaintenance(await store.replay()) && mayBuild(viewer, optionalKey(b)) ? startRun(id, "fix", optionalKey(b)) : false;
      return send(res, 202, { workItemId: workItemId ?? null, fixing });
    }
    if (method === "POST" && action === "corrections") {
      const b = await body(req);
      if (runs.has(id)) throw new HttpError(409, "it is being worked on right now; try again when this round finishes");
      const store = await FsStore.open(o.root, id).catch(() => {
        throw new HttpError(404, "no such project");
      });
      const r = await correctAssumption(store, text(b, "decisionId", 20), text(b, "text")).catch((e: Error) => {
        throw new HttpError(400, e.message);
      });
      const fixing = r.workItemId && !runs.has(id) && canStartMaintenance(await store.replay()) && mayBuild(viewer, optionalKey(b)) ? startRun(id, "fix", optionalKey(b)) : false;
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
      const opts = await runOptions(o.root, id, await flagsFor(id), { log: (l) => log(`[${id}] ${l}`) });
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
    if (method === "POST" && action === "files") {
      await view(id);
      const name = url.searchParams.get("name") ?? "";
      if (!name.trim()) throw new HttpError(400, "name is missing");
      const data = await bytes(req, GIVEN_LIMITS.fileBytes);
      const f = await addGiven(join(o.root, id), name, data).catch((e: Error) => {
        throw e instanceof GivenError ? new HttpError(400, e.message) : e;
      });
      return send(res, 201, { name: f.name, bytes: f.bytes, kind: f.kind });
    }
    if (method === "DELETE" && !action) {
      // Everything about the project goes: its records, its workspace, its releases, and the app this server keeps running.
      const v = await view(id);
      if (await isRunning(id)) throw new HttpError(409, "it is being worked on right now; try again when this round finishes");
      clearTimeout(retries.get(id));
      retries.delete(id);
      problems.delete(id);
      await ports.release(id);
      await live?.forget(id);
      await people.disown(id);
      await rm(join(o.root, id), { recursive: true, force: true });
      log(`[${id}] deleted`);
      // An app put online elsewhere (Vercel, Netlify, Cloudflare) is not Karigor's to remove; the person is told where it still is.
      const stillOnline = o.deploy && o.deploy !== "local" ? v.live?.url : undefined;
      return send(res, 200, { deleted: true, ...(stillOnline ? { stillOnline } : {}) });
    }
    if (method === "POST" && action === "signin") {
      // The app's owner gets their first way in (or a fresh one): a one-time link to choose a password.
      const b = await body(req);
      const email = text(b, "email", 200);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "that does not look like an email address");
      const name = typeof b["name"] === "string" ? b["name"].trim().slice(0, 100) : "";
      const v = await view(id);
      if (!v.live) throw new HttpError(409, "it is not online yet");
      if (!v.signIn) throw new HttpError(409, "this app has no sign-in to set up");
      const opts = await runOptions(o.root, id, await flagsFor(id), { log: (l) => log(`[${id}] ${l}`) });
      const live = (await projectView(await FsStore.open(o.root, id), false)).live;
      const r = await adminLink(opts.deploy, email, name, { projectDir: join(o.root, id), ...(live?.url ? { url: live.url } : {}) });
      const link = /https?:\/\/\S+\/welcome\/\S+/.exec(r.output)?.[0];
      if (!r.ok || !link) {
        log(`[${id}] sign-in link failed: ${r.output}`);
        throw new HttpError(400, "the sign-in link could not be made here; ask whoever runs this Karigor");
      }
      return send(res, 200, await publicUrls({ link }));
    }
    if (method === "POST" && action === "phone") {
      // Phone apps are made in the background (about ten minutes in the cloud); the page shows how it goes.
      const b = await body(req);
      const v = await view(id);
      if (!v.phone) throw new HttpError(409, "phone apps need the app online at an https address");
      if (phoneJobs.has(id) || v.phone.status === "building") throw new HttpError(409, "the phone apps are being made right now");
      const opts = await runOptions(o.root, id, await flagsFor(id), { log: (l) => log(`[${id}] ${l}`) });
      const store = await FsStore.open(o.root, id);
      const job = projectPhoneApps({ store, ...(opts.deploy ? { deploy: opts.deploy } : {}), ...(isLang(b["lang"]) ? { lang: b["lang"] } : {}), log: (l) => log(`[${id}] ${l}`) })
        .then(() => undefined, (e: Error) => log(`[${id}] phone apps: ${e.message}`))
        .finally(() => phoneJobs.delete(id));
      phoneJobs.set(id, job);
      return send(res, 202, { started: true });
    }
    if (method === "POST" && action === "key") {
      // A service's owner gets an access key with every permission, shown once.
      const b = await body(req);
      const name = typeof b["name"] === "string" ? b["name"].trim().slice(0, 100) : "";
      const v = await view(id);
      if (!v.live) throw new HttpError(409, "it is not online yet");
      if (!v.accessKey) throw new HttpError(409, "this app has no access keys");
      const opts = await runOptions(o.root, id, await flagsFor(id), { log: (l) => log(`[${id}] ${l}`) });
      const live = (await projectView(await FsStore.open(o.root, id), false)).live;
      const r = await ownerAccessKey(opts.deploy, name, { projectDir: join(o.root, id), ...(live?.url ? { url: live.url } : {}) });
      if (!r.ok || !r.key) {
        log(`[${id}] access key failed: ${r.output}`);
        throw new HttpError(400, "the access key could not be made here; ask whoever runs this Karigor");
      }
      log(`[${id}] made an access key for ${name || "Owner"}`);
      return send(res, 200, { key: r.key });
    }
    throw new HttpError(404, "not found");
  };

  const server = createServer((req, res) => {
    const lang = langOf(req);
    handle(req, res).catch((e: Error) => {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) send(res, e.status, { error: errorIn(lang, e.message) });
      else {
        log(`error: ${e.stack ?? e.message}`);
        send(res, 500, { error: errorIn(lang, "something went wrong on the server") });
      }
    });
  });

  live?.start();
  server.on("close", () => void live?.stop());

  return {
    server,
    runs,
    ...(live ? { live } : {}),
    idle: async () => {
      while (runs.size) await Promise.all([...runs.values()]);
    },
  };
}
