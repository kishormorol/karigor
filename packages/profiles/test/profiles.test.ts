import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { fixture, parseVitestJson, profileFor, webApp } from "../src/index.js";

const run = promisify(execFile);

describe("profiles", () => {
  it("fixture scaffolds, runs its scripts, and its test output parses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-fixture-"));
    await fixture.scaffold(dir);
    expect(await readdir(dir)).toContain(".gitignore");
    const ok = await run("node", ["test.mjs"], { cwd: dir });
    expect(fixture.parseTests(ok.stdout, ok.stderr, 0)).toMatchObject({ passed: 1, failed: 0, skipped: 0 });
    await writeFile(join(dir, "tests.json"), JSON.stringify({ passed: 2, failed: 1, skipped: 0 }));
    const bad = await run("node", ["test.mjs"], { cwd: dir }).catch((e: { stdout: string; stderr: string; code: number }) => e);
    expect(bad.code).toBe(1);
    expect(fixture.parseTests(bad.stdout, bad.stderr, 1)).toMatchObject({ passed: 2, failed: 1 });
  });

  it("web-app scaffold has the files the stack guide promises", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-webapp-"));
    await webApp.scaffold(dir);
    for (const f of ["package.json", ".gitignore", ".env.example", "app/page.tsx", "app/api/health/route.ts", "src/db/schema.ts", "src/lib/health.ts", "tests/health.test.ts", "vitest.config.ts", "eslint.config.mjs"]) {
      await expect(readFile(join(dir, f), "utf8"), f).resolves.toBeTruthy();
    }
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.scripts.test).toMatch(/vitest run --reporter=json/);
    expect(webApp.stackGuide).toMatch(/src\/db\/schema.ts/);
  });

  it("parses the Vitest JSON reporter even with noise around it, and falls back on exit code", () => {
    const out = 'noise\n{"numTotalTests":3,"numPassedTests":2,"numFailedTests":1,"numPendingTests":0,"startTime":1000,"testResults":[{"endTime":1250}]}\n';
    expect(parseVitestJson(out, "", 1)).toEqual({ passed: 2, failed: 1, skipped: 0, durationMs: 250 });
    expect(parseVitestJson("no report", "", 1)).toMatchObject({ passed: 0, failed: 1 });
    expect(parseVitestJson("no report", "", 0)).toMatchObject({ passed: 0, failed: 0 });
  });

  it("names unknown profiles", () => {
    expect(() => profileFor("mobile-app")).toThrow(/not implemented yet/);
    expect(profileFor("web-app").name).toBe("web-app");
  });
});
