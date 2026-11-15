/**
 * The Netlify and Cloudflare Pages targets against real accounts: preview, go live, release again,
 * prove and perform a rollback, then delete what was made. Skipped unless KARIGOR_LIVE=1 and the
 * target's token is set, so `pnpm test` stays free and offline.
 *
 *   KARIGOR_LIVE=1 NETLIFY_AUTH_TOKEN=... pnpm test packages/deploy/test/live.test.ts
 *   KARIGOR_LIVE=1 CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm test packages/deploy/test/live.test.ts
 *
 * Needs `pnpm`, and the `netlify` or `wrangler` CLI, on PATH. Each run makes a throwaway site named
 * karigor-live-<random> and deletes it at the end, even when a step fails.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CloudflarePagesDeploy, NetlifyDeploy, type DeployAdapter, type DeployResult, type LiveRelease } from "../src/index.js";

const LIVE = process.env["KARIGOR_LIVE"] === "1";
const SCAFFOLD = fileURLToPath(new URL("../../profiles/scaffolds/static-site", import.meta.url));
const name = `karigor-live-${Math.random().toString(36).slice(2, 8)}`;

/** A static site in a git repository whose home page says `marker`; returns the commit. */
async function site(dir: string, marker: string): Promise<string> {
  await writeFile(
    join(dir, "site", "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Karigor live check</title><meta name="description" content="A throwaway page from Karigor's live deploy check."></head><body><main><h1>${marker}</h1></main></body></html>\n`,
  );
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  git("add", "-A");
  git("-c", "user.name=karigor", "-c", "user.email=karigor@example.invalid", "commit", "-q", "-m", marker);
  return git("rev-parse", "HEAD");
}

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "karigor-live-"));
  await cp(SCAFFOLD, dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  return dir;
}

async function serves(url: string, marker: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const body = await fetch(url, { cache: "no-store" }).then((r) => r.text(), () => "");
    if (body.includes(marker)) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** The whole life of a release on one target, in the order Karigor drives it. */
async function lifecycle(deploy: DeployAdapter) {
  const dir = await workspace();
  const release = async (n: number, marker: string): Promise<{ preview: DeployResult; live: DeployResult; version: string }> => {
    const commit = await site(dir, marker);
    const version = `r${n}-${commit.slice(0, 7)}`;
    const r = { dir, version, commit, key: `${name}-${n}` };
    const preview = await deploy.preview(r);
    expect(preview, preview.output).toMatchObject({ ok: true });
    expect(await serves(preview.url!, marker), `preview ${preview.url} shows release ${n}`).toBe(true);
    const live = await deploy.promote({ ...r, preview });
    expect(live, live.output).toMatchObject({ ok: true });
    return { preview, live, version };
  };

  const first = await release(1, "Release one");
  expect(await serves(first.live.url!, "Release one")).toBe(true);
  const second = await release(2, "Release two");
  expect(await serves(second.live.url!, "Release two")).toBe(true);

  const back: LiveRelease = { url: first.live.url!, id: first.live.id ?? first.preview.id!, version: first.version };
  const proof = await deploy.verifyRollback({ dir, live: back });
  expect(proof.ok, proof.output).toBe(true);
  const rolled = await deploy.rollback({ dir, live: back });
  expect(rolled.ok, rolled.output).toBe(true);
  expect(await serves(second.live.url!, "Release one"), "production is back on release one").toBe(true);
}

describe.skipIf(!LIVE || !process.env["NETLIFY_AUTH_TOKEN"])("Netlify, on a real account", () => {
  const token = process.env["NETLIFY_AUTH_TOKEN"]!;
  afterAll(async () => {
    const sites = (await fetch(`https://api.netlify.com/api/v1/sites?name=${name}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json(), () => [])) as { id: string; name: string }[];
    for (const s of sites.filter((x) => x.name === name)) await fetch(`https://api.netlify.com/api/v1/sites/${s.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  });

  it("previews, goes live, releases again and rolls back", { timeout: 15 * 60_000 }, async () => {
    await lifecycle(new NetlifyDeploy({ project: name, kind: "static-site", log: (l) => console.log(`[netlify] ${l}`) }));
  });
});

describe.skipIf(!LIVE || !process.env["CLOUDFLARE_API_TOKEN"] || !process.env["CLOUDFLARE_ACCOUNT_ID"])("Cloudflare Pages, on a real account", () => {
  afterAll(async () => {
    const account = process.env["CLOUDFLARE_ACCOUNT_ID"]!;
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${name}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env["CLOUDFLARE_API_TOKEN"]}` } }).catch(() => undefined);
  });

  it("previews, goes live, releases again and rolls back", { timeout: 15 * 60_000 }, async () => {
    await lifecycle(new CloudflarePagesDeploy({ project: name }));
  });
});
