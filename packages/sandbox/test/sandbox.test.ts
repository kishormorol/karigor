import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture } from "@karigor/profiles";
import { LocalSandbox, Workspace, parseAudit, scanSecrets } from "../src/index.js";

async function ws() {
  const dir = join(await mkdtemp(join(tmpdir(), "karigor-ws-")), "workspace");
  return Workspace.create(dir, fixture);
}

describe("Workspace", () => {
  it("scaffolds, commits a baseline, and refuses a non-empty directory", async () => {
    const w = await ws();
    expect(await w.isClean()).toBe(true);
    expect(await w.baseline()).toBe(await w.head());
    await expect(Workspace.create(w.dir, fixture)).rejects.toThrow(/not empty/);
    const again = await Workspace.open(w.dir);
    expect(await again.head()).toBe(await w.head());
    await expect(Workspace.open(join(w.dir, "nope"))).rejects.toThrow(/no workspace/);
  });

  it("commits items by name, finds their commits, diffs them, and reverts them", async () => {
    const w = await ws();
    const base = await w.head();
    expect(await w.commitAll("karigor(b1): nothing")).toBeUndefined();
    await writeFile(join(w.dir, "src/b1.js"), "export const b1 = 1;\n");
    const sha1 = await w.commitAll("karigor(b1): add b1");
    await writeFile(join(w.dir, "src/b2.js"), "export const b2 = 2;\n");
    await w.commitAll("karigor(b2): add b2");
    await writeFile(join(w.dir, "src/b1.js"), "export const b1 = 11;\n");
    const sha2 = await w.commitAll("karigor(b1): tweak b1");
    expect(await w.itemCommits("b1")).toEqual([sha1, sha2]);
    expect(await w.itemCommits("b9")).toEqual([]);
    expect(await w.changedFiles(base)).toEqual([{ path: "src/b1.js", action: "write" }, { path: "src/b2.js", action: "write" }]);
    expect(await w.diff(`${sha1}^`)).toMatch(/\+export const b1 = 11;/);
    const sandbox = new LocalSandbox(w, fixture);
    expect(await sandbox.diff("b1")).toMatch(/b1 = 11/);
    expect(await sandbox.diff("b1")).not.toMatch(/b2 = 2/);
    expect(await sandbox.diff("b9")).toBe("");

    const rev = await w.revertItem("b1", "parked");
    expect(rev).toBeDefined();
    expect(await w.changedFiles(base)).toEqual([{ path: "src/b2.js", action: "write" }]);
    expect(await w.revertItem("b1", "again")).toBeUndefined(); // already reverted
  });

  it("reset throws away uncommitted edits and new files", async () => {
    const w = await ws();
    await writeFile(join(w.dir, "src/index.js"), "changed\n");
    await writeFile(join(w.dir, "new.txt"), "x\n");
    expect(await w.isClean()).toBe(false);
    await w.reset();
    expect(await w.isClean()).toBe(true);
  });
});

describe("LocalSandbox", () => {
  it("runs real tests, lint and build from the profile and reports failures", async () => {
    const w = await ws();
    const s = new LocalSandbox(w, fixture);
    expect(await s.runTests()).toMatchObject({ suite: "fixture", passed: 1, failed: 0 });
    await writeFile(join(w.dir, "tests.json"), JSON.stringify({ passed: 3, failed: 2, skipped: 1 }));
    const t = await s.runTests("b1");
    expect(t).toMatchObject({ passed: 3, failed: 2, skipped: 1 });
    expect(t.output).toMatch(/\$ node test.mjs/);
    expect((await s.lint()).ok).toBe(true);
    await writeFile(join(w.dir, "lint-fail"), "");
    expect(await s.lint()).toMatchObject({ ok: false });
    expect((await s.build()).ok).toBe(true);
    await writeFile(join(w.dir, "build-fail"), "");
    expect((await s.build()).ok).toBe(false);
  });

  it("security scan finds secrets and committed env files, and is clean otherwise", async () => {
    const w = await ws();
    const s = new LocalSandbox(w, fixture);
    expect((await s.securityScan()).findings).toEqual([]);
    await writeFile(join(w.dir, "src/config.js"), 'const key = "AKIAABCDEFGHIJKLMNOP";\n');
    await writeFile(join(w.dir, ".env.local"), "SECRET=1\n");
    await writeFile(join(w.dir, ".env.example"), "SECRET=\n");
    const r = await s.securityScan();
    expect(r.findings.map((f) => `${f.severity}:${f.title}@${f.location}`).sort()).toEqual([
      "critical:AWS access key id in source@src/config.js:1",
      "critical:environment file committed; keep secrets out of git@.env.local",
    ]);
    await rm(join(w.dir, "src/config.js"));
    await rm(join(w.dir, ".env.local"));
    expect((await s.securityScan()).findings).toEqual([]);
  });

  it("checks a real URL and reports a dead one", async () => {
    const server = createServer((req, res) => {
      res.statusCode = req.url === "/ok" ? 200 : 503;
      res.end(req.url === "/ok" ? "hello" : "down");
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const s = new LocalSandbox(await ws(), fixture);
    expect(await s.checkUrl(`http://127.0.0.1:${port}/ok`)).toMatchObject({ ok: true, status: 200 });
    expect(await s.checkUrl(`http://127.0.0.1:${port}/down`)).toMatchObject({ ok: false, status: 503 });
    server.close();
    expect((await s.checkUrl("http://127.0.0.1:1/")).ok).toBe(false);
    expect((await s.verifyRollback()).ok).toBe(false);
  });

  it("parses both audit formats at high and critical only", () => {
    const classic = JSON.stringify({ advisories: { 1: { severity: "high", title: "Prototype pollution", module_name: "lodash" }, 2: { severity: "low", title: "x", module_name: "y" } } });
    expect(parseAudit(classic)).toEqual([{ severity: "high", title: "lodash: Prototype pollution", location: "package.json" }]);
    const modern = JSON.stringify({ vulnerabilities: { minimist: { severity: "critical", name: "minimist" }, other: { severity: "moderate", name: "other" } } });
    expect(parseAudit(modern)).toEqual([{ severity: "critical", title: "minimist: vulnerable version", location: "package.json" }]);
    expect(parseAudit("not json")).toEqual([]);
    // what pnpm really prints: indented JSON over many lines, sometimes after a warning
    const real = "WARN some notice\n" + JSON.stringify({ actions: [], advisories: { 1116251: { severity: "high", title: "SQL injection via identifiers", module_name: "drizzle-orm", findings: [{ version: "0.44.7" }] } }, metadata: {} }, null, 2) + "\n";
    expect(parseAudit(real)).toEqual([{ severity: "high", title: "drizzle-orm: SQL injection via identifiers", location: "package.json" }]);
  });

  it("secrets scan skips binaries, lockfiles and example env files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-sec-"));
    await writeFile(join(dir, "pnpm-lock.yaml"), "AKIAABCDEFGHIJKLMNOP\n");
    await writeFile(join(dir, ".env.example"), "KEY=AKIAABCDEFGHIJKLMNOP\n");
    await writeFile(join(dir, "ok.ts"), "const s = process.env.KEY;\n");
    expect(await scanSecrets(dir, ["pnpm-lock.yaml", ".env.example", "ok.ts"])).toEqual([]);
  });
});
