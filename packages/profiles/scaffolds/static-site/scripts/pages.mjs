/**
 * The site's own checks, used by `pnpm lint`, `pnpm build` and the tests: every page has a title, a
 * description, a language and a phone-sized viewport; every picture has alt text; every link and
 * picture inside the site points at a file that exists. Pictures the person gave are in public/given/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = join(ROOT, "site");
export const PUBLIC = join(ROOT, "public");

/** Every file under a folder, as paths relative to it. */
export function filesIn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesIn(p).map((f) => join(name, f)));
    else out.push(name);
  }
  return out;
}

export const pages = () => filesIn(SITE).filter((f) => f.endsWith(".html"));

/** Where a local address leads: a file in site/ or public/, with clean URLs (/about → about.html). */
export function resolves(fromPage, ref) {
  const path = decodeURIComponent(ref.split(/[?#]/)[0]);
  if (!path) return true;
  const base = path.startsWith("/") ? path.slice(1) : join(dirname(fromPage), path);
  const candidates = [base, `${base}.html`, join(base, "index.html")];
  return candidates.some((c) => [SITE, PUBLIC].some((root) => existsSync(join(root, c)) && statSync(join(root, c)).isFile()));
}

const isExternal = (ref) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) || ref.startsWith("#");

/** What is wrong with one page, in plain words. Empty when it is fine. */
export function problems(page, html = readFileSync(join(SITE, page), "utf8")) {
  const out = [];
  if (!/<html[^>]*\slang="[^"]+"/i.test(html)) out.push(`${page}: <html> needs a lang, such as lang="en"`);
  if (!/<title>[^<]+<\/title>/i.test(html)) out.push(`${page}: needs a <title>`);
  if (!/<meta[^>]+name="viewport"[^>]*>/i.test(html)) out.push(`${page}: needs <meta name="viewport" content="width=device-width, initial-scale=1"> to fit phones`);
  if (!/<meta[^>]+name="description"[^>]+content="[^"]+"/i.test(html)) out.push(`${page}: needs <meta name="description" content="..."> for search engines and link previews`);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) if (!/\salt="/i.test(m[0])) out.push(`${page}: a picture has no alt text: ${m[0].slice(0, 80)}`);
  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/gi)) {
    const ref = m[1].trim();
    if (!ref || isExternal(ref)) continue;
    if (!resolves(page, ref)) out.push(`${page}: "${ref}" points at nothing in the site`);
  }
  return out;
}

export const allProblems = () => pages().flatMap((p) => problems(p));
export const rel = (p) => relative(ROOT, p);
