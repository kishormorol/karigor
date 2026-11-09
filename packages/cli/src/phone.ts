import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { ignoreInProjectGit } from "@karigor/store";
import { packageIdFor, phoneFiles, safeColor, type PhoneAppInfo } from "./phone-files.js";

export * from "./phone-files.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
/** Runs a program; `input` goes to its standard input (secrets are passed this way, never as arguments). */
export type PhoneExec = (cmd: string, args: string[], o: { cwd: string; input?: string; env?: Record<string, string>; timeoutMs?: number }) => Promise<ExecResult>;

export const phoneExec: PhoneExec = (cmd, args, o) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: { ...process.env, ...o.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), o.timeoutMs ?? 10 * 60 * 1000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${e.message}`, code: 127 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(o.input ?? "");
  });

/** What Karigor remembers about a project's phone apps, in `phone-apps.json` (no secrets). */
export interface PhoneState {
  status: "building" | "ready" | "failed";
  /** owner/name on GitHub. */
  repo?: string;
  packageId: string;
  versionCode: number;
  /** SHA-256 of the upload key, as Android's app links want it. */
  fingerprint?: string;
  /** The value of ANDROID_APP_LINKS last set on the live app. */
  linksSet?: string;
  runUrl?: string;
  startedAt: string;
  finishedAt?: string;
  /** Files of the latest finished build, relative to `phone-builds/`. */
  files?: { path: string; bytes: number }[];
  /** In plain words, when it failed. */
  error?: string;
}

const STATE = "phone-apps.json";
/** Inside the project but never in its git history: the signing key, the apps' own repository, the builds. */
const PRIVATE = ["phone-signing/", "phone/", "phone-builds/"];

export async function phoneState(projectDir: string): Promise<PhoneState | undefined> {
  try {
    return JSON.parse(await readFile(join(projectDir, STATE), "utf8")) as PhoneState;
  } catch {
    return undefined;
  }
}

async function saveState(projectDir: string, s: PhoneState): Promise<void> {
  await writeFile(join(projectDir, STATE), JSON.stringify(s, null, 2) + "\n", "utf8");
}

/** A path inside `phone-builds/` for a file the latest build made, or undefined when it is not one of them. */
export async function phoneBuildFile(projectDir: string, path: string): Promise<string | undefined> {
  const s = await phoneState(projectDir);
  if (!s?.files?.some((f) => f.path === path)) return undefined;
  const full = join(projectDir, "phone-builds", path);
  return relative(join(projectDir, "phone-builds"), full).startsWith("..") ? undefined : full;
}

/**
 * The Android upload key: made once with OpenSSL (a PKCS#12 file, alias "upload", valid 30 years) and
 * kept in `phone-signing/`, readable by this user alone. Losing it means the Play Store refuses updates
 * until Google resets it, so it is never rewritten.
 */
export async function signingKey(projectDir: string, name: string, exec: PhoneExec = phoneExec): Promise<{ file: string; password: string; fingerprint: string }> {
  const dir = join(projectDir, "phone-signing");
  const file = join(dir, "upload.p12");
  const pwFile = join(dir, "password");
  await ignoreInProjectGit(projectDir, PRIVATE);
  if (!(await stat(file).then(() => true, () => false))) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const password = (await import("node:crypto")).randomBytes(24).toString("base64url");
    const key = join(dir, "upload.key");
    const cert = join(dir, "upload.crt");
    const cn = name.replace(/[^\p{L}\p{N} .-]/gu, "").slice(0, 60) || "Karigor app";
    const gen = await exec("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "10950", "-subj", `/CN=${cn}/O=Karigor`], { cwd: dir });
    if (gen.code !== 0) throw new Error(`could not make the signing key (is OpenSSL installed?): ${gen.stderr.trim().split("\n").at(-1)}`);
    // Java reads PKCS#12 made with these (older, widely supported) algorithms on every version.
    const p12 = await exec("openssl", ["pkcs12", "-export", "-inkey", key, "-in", cert, "-name", "upload", "-out", file, "-passout", "stdin", "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1"], { cwd: dir, input: `${password}\n` });
    await rm(key, { force: true });
    if (p12.code !== 0) throw new Error(`could not make the signing key: ${p12.stderr.trim().split("\n").at(-1)}`);
    await writeFile(pwFile, password, { mode: 0o600 });
    await chmod(file, 0o600);
  }
  const password = (await readFile(pwFile, "utf8")).trim();
  const fp = await exec("openssl", ["x509", "-in", join(dir, "upload.crt"), "-noout", "-fingerprint", "-sha256"], { cwd: dir });
  const fingerprint = /=([0-9A-F:]{95})/i.exec(fp.stdout)?.[1]?.toUpperCase();
  if (!fingerprint) throw new Error("could not read the signing key's fingerprint");
  return { file, password, fingerprint };
}

/** Name, colours and icon from the live app's web manifest; sensible values when it has none. */
export async function liveAppInfo(url: string, fetcher: typeof fetch = fetch): Promise<{ name: string; shortName: string; themeColor: string; backgroundColor: string; icon?: string }> {
  const base = new URL(url);
  let m: { name?: unknown; short_name?: unknown; theme_color?: unknown; background_color?: unknown; icons?: { src?: unknown; sizes?: unknown; type?: unknown }[] } = {};
  for (const path of ["/manifest.webmanifest", "/manifest.json"]) {
    try {
      const res = await fetcher(new URL(path, base), { signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        m = (await res.json()) as typeof m;
        break;
      }
    } catch {
      /* try the next name */
    }
  }
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const name = str(m.name, 50) ?? base.hostname.split(".")[0]!;
  const icons = Array.isArray(m.icons) ? m.icons.filter((i) => typeof i?.src === "string") : [];
  const size = (i: { sizes?: unknown }) => (i.sizes === "any" ? 4096 : Math.max(0, ...String(i.sizes ?? "").split(/\s+/).map((s) => Number(s.split("x")[0]) || 0)));
  const best = [...icons].sort((a, b) => size(b) - size(a))[0];
  return {
    name,
    shortName: str(m.short_name, 30) ?? name.slice(0, 30),
    themeColor: safeColor(m.theme_color, "#0e5e55"),
    backgroundColor: safeColor(m.background_color, "#ffffff"),
    ...(best ? { icon: new URL(String(best.src), base).toString() } : {}),
  };
}

const OFFLINE = {
  en: { title: "No connection", text: "Check the phone's internet, then try again.", retry: "Try again" },
  bn: { title: "সংযোগ নেই", text: "ফোনের ইন্টারনেট দেখে আবার চেষ্টা করুন।", retry: "আবার চেষ্টা করুন" },
};

export interface MakePhoneAppsOptions {
  projectDir: string;
  /** Used for the package id and the repository name (the Vercel project's slug). */
  slug: string;
  /** The live app, https. */
  url: string;
  lang?: "en" | "bn";
  exec?: PhoneExec;
  fetcher?: typeof fetch;
  log?: (line: string) => void;
  /** Wait for the cloud build and download what it made (default true). */
  wait?: boolean;
  /** How long to wait for the build (default 45 minutes). */
  waitMs?: number;
  pollMs?: number;
  /** Puts ANDROID_APP_LINKS on the live app and makes it live, so Android opens the app full screen. */
  setAppLinks?: (value: string) => Promise<{ ok: boolean; output: string }>;
  clock?: () => Date;
}

/**
 * Makes (or updates) the phone apps: writes their repository, keeps it on GitHub (private), gives the
 * cloud build the signing key as a secret, pushes, waits for the build, and downloads the Android
 * app (APK and Play Store bundle) and the iPhone simulator app into `phone-builds/`.
 */
export async function makePhoneApps(o: MakePhoneAppsOptions): Promise<PhoneState> {
  const exec = o.exec ?? phoneExec;
  const log = o.log ?? (() => {});
  const now = () => (o.clock ?? (() => new Date()))().toISOString();
  const url = new URL(o.url);
  if (url.protocol !== "https:" || /^(localhost|127\.|\[::1\])/.test(url.hostname)) throw new Error("phone apps need the app online at an https address, such as on Vercel; an app on this computer cannot be put on phones");
  const before = await phoneState(o.projectDir);
  const packageId = before?.packageId ?? packageIdFor(o.slug);
  const versionCode = (before?.versionCode ?? 0) + 1;
  const state: PhoneState = { status: "building", packageId, versionCode, startedAt: now(), ...(before?.repo ? { repo: before.repo } : {}), ...(before?.linksSet ? { linksSet: before.linksSet } : {}), ...(before?.files ? { files: before.files } : {}) };
  await ignoreInProjectGit(o.projectDir, PRIVATE);
  await saveState(o.projectDir, state);
  const fail = async (error: string): Promise<PhoneState> => {
    Object.assign(state, { status: "failed", error, finishedAt: now() });
    await saveState(o.projectDir, state);
    log(`phone apps: ${error}`);
    return state;
  };
  try {
    const gh = async (args: string[], cwd: string, input?: string) => {
      const r = await exec("gh", args, { cwd, ...(input !== undefined ? { input } : {}), timeoutMs: 5 * 60 * 1000 });
      if (r.code === 127) throw new Error("the GitHub command line (gh) is not installed here; phone apps are built on GitHub");
      return r;
    };
    const who = await gh(["api", "user", "--jq", ".login"], o.projectDir);
    if (who.code !== 0 || !who.stdout.trim()) throw new Error("GitHub is not signed in here: run `gh auth login` once (phone apps are built on GitHub, free for private repositories within its monthly minutes)");
    const owner = who.stdout.trim();

    const app = await liveAppInfo(o.url, o.fetcher);
    const key = await signingKey(o.projectDir, app.name, exec);
    state.fingerprint = key.fingerprint;
    const info: PhoneAppInfo = { ...app, url: url.origin, packageId, versionCode, versionName: `1.${versionCode}`, offline: OFFLINE[o.lang ?? "en"] };

    // The apps' own repository: just these files, never the app's code.
    const dir = join(o.projectDir, "phone");
    await mkdir(dir, { recursive: true });
    for (const [path, content] of Object.entries(phoneFiles(info))) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content, "utf8");
    }
    const git = (args: string[]) => exec("git", ["-c", "user.name=karigor", "-c", "user.email=karigor@localhost", "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...args], { cwd: dir, timeoutMs: 5 * 60 * 1000 });
    if (!(await stat(join(dir, ".git")).then(() => true, () => false))) await git(["init", "-q", "-b", "main"]);
    await git(["add", "-A"]);
    await git(["commit", "-q", "--allow-empty", "-m", `Phone apps ${info.versionName} for ${url.origin}`]);
    const sha = (await git(["rev-parse", "HEAD"])).stdout.trim();

    const repo = state.repo ?? `${owner}/${o.slug}-phone`.slice(0, 100);
    if ((await gh(["repo", "view", repo, "--json", "name"], dir)).code !== 0) {
      log(`phone apps: making the private repository ${repo} on GitHub`);
      const made = await gh(["repo", "create", repo, "--private", "--description", `Phone apps for ${url.host}, made by Karigor`], dir);
      if (made.code !== 0) throw new Error(`could not make the GitHub repository ${repo}: ${made.stderr.trim().split("\n").at(-1)}`);
    }
    state.repo = repo;
    await saveState(o.projectDir, state);
    const p12 = (await readFile(key.file)).toString("base64");
    for (const [name, value] of [["ANDROID_KEYSTORE_B64", p12], ["ANDROID_KEYSTORE_PASSWORD", key.password]] as const) {
      const r = await gh(["secret", "set", name, "--repo", repo], dir, value);
      if (r.code !== 0) throw new Error(`could not give the cloud build its signing key: ${r.stderr.trim().split("\n").at(-1)}`);
    }
    const remote = `https://github.com/${repo}.git`;
    await git(["remote", "remove", "origin"]);
    await git(["remote", "add", "origin", remote]);
    const push = await git(["push", "-q", "-f", "origin", "main"]);
    if (push.code !== 0) throw new Error(`could not send the files to GitHub: ${push.stderr.trim().split("\n").at(-1)}`);
    log(`phone apps: version ${info.versionName} sent to ${repo}; the cloud build takes about 10 minutes`);

    // Android trusts the app full screen once the live app names this key.
    const links = `${packageId}:${key.fingerprint}`;
    if (o.setAppLinks && state.linksSet !== links) {
      const r = await o.setAppLinks(links);
      if (r.ok) state.linksSet = links;
      else log(`phone apps: the app could not be told about the Android app yet (${r.output.split("\n").at(-1)}); it opens with a small address bar until then`);
    }
    await saveState(o.projectDir, state);
    if (o.wait === false) return state;

    // The run for this exact commit.
    const deadline = Date.now() + (o.waitMs ?? 45 * 60 * 1000);
    const pause = () => new Promise((r) => setTimeout(r, o.pollMs ?? 20_000));
    let run: { databaseId: number; url: string; status: string; conclusion: string } | undefined;
    while (Date.now() < deadline) {
      const r = await gh(["run", "list", "--repo", repo, "--workflow", "phone-apps.yml", "--commit", sha, "--json", "databaseId,url,status,conclusion", "--limit", "1"], dir);
      try {
        run = (JSON.parse(r.stdout) as (typeof run)[])[0];
      } catch {
        run = undefined;
      }
      if (run) {
        state.runUrl = run.url;
        await saveState(o.projectDir, state);
        if (run.status === "completed") break;
      }
      await pause();
    }
    if (!run || run.status !== "completed") return await fail(`the cloud build did not finish in time${state.runUrl ? `; see ${state.runUrl}` : ""}`);
    if (run.conclusion !== "success") return await fail(`the cloud build failed (${run.conclusion}); see ${run.url}`);

    const out = join(o.projectDir, "phone-builds", `v${versionCode}`);
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    const dl = await gh(["run", "download", String(run.databaseId), "--repo", repo, "--dir", out, "--name", "android", "--name", "ios"], dir);
    if (dl.code !== 0) return await fail(`the apps were built but could not be downloaded: ${dl.stderr.trim().split("\n").at(-1)}`);
    const files: { path: string; bytes: number }[] = [];
    for (const sub of await readdir(out)) {
      for (const f of await readdir(join(out, sub)).catch(() => [] as string[])) {
        files.push({ path: `v${versionCode}/${sub}/${f}`, bytes: (await stat(join(out, sub, f))).size });
      }
    }
    // Keep the last two builds.
    for (const old of (await readdir(join(o.projectDir, "phone-builds"))).filter((d) => /^v\d+$/.test(d) && Number(d.slice(1)) < versionCode - 1)) {
      await rm(join(o.projectDir, "phone-builds", old), { recursive: true, force: true });
    }
    Object.assign(state, { status: "ready", files, finishedAt: now() });
    delete state.error;
    await saveState(o.projectDir, state);
    log(`phone apps: ready (${files.map((f) => f.path.split("/").at(-1)).join(", ")})`);
    return state;
  } catch (e) {
    return await fail((e as Error).message);
  }
}
