import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

/**
 * Files the person gave (a logo, photos, a price list, last year's customers) live in `<project>/given/`.
 * Each run copies them into the workspace: pictures where the app can show them, everything else in a
 * private folder that is never served, so a customer list cannot leak through the website.
 */
export const GIVEN_DIR = "given";
export const GIVEN_LIMITS = { fileBytes: 10 * 1024 * 1024, totalBytes: 50 * 1024 * 1024, files: 30 };

const IMAGES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"]);
const TEXT = new Set([".csv", ".tsv", ".txt", ".md", ".json"]);
const OTHER = new Set([".pdf", ".xlsx", ".xls", ".docx", ".doc", ".ods", ".odt", ".mp3", ".mp4", ".woff", ".woff2", ".ttf"]);
export const GIVEN_KINDS = [...IMAGES, ...TEXT, ...OTHER];

export interface GivenFile {
  name: string;
  bytes: number;
  /** Where it sits in the workspace. */
  path: string;
  kind: "image" | "text" | "document";
}

export class GivenError extends Error {}

/** A file name safe on every system and in a URL: letters, digits, dot, dash, underscore; Bangla and other letters become dashes. */
export function safeGivenName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ext = extname(base).toLowerCase();
  const stem = base.slice(0, base.length - extname(base).length).normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  return `${stem}${ext}`;
}

function kindOf(name: string): GivenFile["kind"] {
  const ext = extname(name).toLowerCase();
  return IMAGES.has(ext) ? "image" : TEXT.has(ext) ? "text" : "document";
}

/** Pictures go under public/ so the app can show them; the rest stays private. */
export const givenPath = (name: string) => (kindOf(name) === "image" ? `public/given/${name}` : `given/${name}`);

export async function listGiven(projectDir: string): Promise<GivenFile[]> {
  const dir = join(projectDir, GIVEN_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: GivenFile[] = [];
  for (const name of names.sort()) {
    const s = await stat(join(dir, name)).catch(() => undefined);
    if (s?.isFile()) out.push({ name, bytes: s.size, path: givenPath(name), kind: kindOf(name) });
  }
  return out;
}

/** Keeps a file the person gave; a file with the same name replaces the old one. */
export async function addGiven(projectDir: string, name: string, data: Buffer): Promise<GivenFile> {
  const safe = safeGivenName(name);
  if (!GIVEN_KINDS.includes(extname(safe))) throw new GivenError(`files of this kind cannot be added (it can take: ${GIVEN_KINDS.join(" ")})`);
  if (data.length === 0) throw new GivenError("the file is empty");
  if (data.length > GIVEN_LIMITS.fileBytes) throw new GivenError("the file is too big (at most 10 MB)");
  const have = (await listGiven(projectDir)).filter((f) => f.name !== safe);
  if (have.length >= GIVEN_LIMITS.files) throw new GivenError(`a project can have at most ${GIVEN_LIMITS.files} files`);
  if (have.reduce((n, f) => n + f.bytes, 0) + data.length > GIVEN_LIMITS.totalBytes) throw new GivenError("the project's files are too big together (at most 50 MB)");
  await mkdir(join(projectDir, GIVEN_DIR), { recursive: true });
  await writeFile(join(projectDir, GIVEN_DIR, safe), data);
  return { name: safe, bytes: data.length, path: givenPath(safe), kind: kindOf(safe) };
}

/** Copies the given files into a workspace; returns the paths it wrote (new or changed). */
export async function syncGiven(projectDir: string, workspaceDir: string): Promise<string[]> {
  const wrote: string[] = [];
  for (const f of await listGiven(projectDir)) {
    const data = await readFile(join(projectDir, GIVEN_DIR, f.name));
    const target = join(workspaceDir, f.path);
    const old = await readFile(target).catch(() => undefined);
    if (old && old.equals(data)) continue;
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, data);
    wrote.push(f.path);
  }
  return wrote;
}

const size = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The files for an agent's prompt: where each is, and the start of each text file. */
export async function renderGiven(projectDir: string): Promise<string | undefined> {
  const files = await listGiven(projectDir);
  if (!files.length) return undefined;
  const lines = [
    "The person added these files. Use them where they fit: a logo or photos in the pages, a list of products, prices or customers as the app's starting data (load it with a seed or import step, never by pasting personal data into code). Pictures are served from /given/<name>; the other files are private and never served.",
    "",
  ];
  for (const f of files) {
    lines.push(`- \`${f.path}\` (${f.kind}, ${size(f.bytes)})`);
    if (f.kind === "text") {
      const text = (await readFile(join(projectDir, GIVEN_DIR, f.name), "utf8").catch(() => "")).split("\n").slice(0, 15).join("\n").slice(0, 2000);
      if (text.trim()) lines.push("", "  First lines:", "", "  ```", ...text.split("\n").map((l) => `  ${l}`), "  ```", "");
    }
  }
  return lines.join("\n");
}
