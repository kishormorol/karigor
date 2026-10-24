import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { fixture, parsePlaywrightJson, parseVitestJson, profileFor, renderCapabilities, webApp } from "../src/index.js";

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
    for (const f of ["package.json", ".gitignore", ".env.example", "app/(app)/page.tsx", "app/(app)/layout.tsx", "app/login/page.tsx", "app/welcome/[token]/page.tsx", "app/api/health/route.ts", "src/db/schema.ts", "src/lib/access.ts", "src/server/people.ts", "src/server/auth.ts", "src/components/ui-client.tsx", "playwright.config.ts", "tests/e2e/helpers.ts", "scripts/admin-link.ts", "src/lib/health.ts", "tests/health.test.ts", "vitest.config.ts", "eslint.config.mjs", "src/server/messages.ts", "src/server/files.ts", "src/server/jobs.ts", "app/api/jobs/route.ts", "app/(app)/files/[id]/route.ts", "app/manifest.ts", "drizzle/0001_messages_files_jobs.sql"]) {
      await expect(readFile(join(dir, f), "utf8"), f).resolves.toBeTruthy();
    }
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.scripts.test).toMatch(/vitest run --reporter=json/);
    expect(webApp.stackGuide).toMatch(/src\/db\/schema.ts/);
    // what the guide tells the developer to use is really there, and the scheduler can reach it
    for (const m of ["sendEmail", "sendSms", "saveUpload", "JOBS"]) expect(webApp.stackGuide).toContain(m);
    expect(JSON.parse(await readFile(join(dir, "vercel.json"), "utf8")).crons).toEqual([{ path: "/api/jobs", schedule: expect.any(String) }]);
    expect(await readFile(join(dir, "src/lib/session-cookie.ts"), "utf8")).toContain("api\\/jobs");
    expect(await readFile(join(dir, ".env.example"), "utf8")).toMatch(/# karigor: generate\nCRON_SECRET=/);
  });

  it("parses the Vitest JSON reporter even with noise around it, and falls back on exit code", () => {
    const out = 'noise\n{"numTotalTests":3,"numPassedTests":2,"numFailedTests":1,"numPendingTests":0,"startTime":1000,"testResults":[{"endTime":1250}]}\n';
    expect(parseVitestJson(out, "", 1)).toEqual({ passed: 2, failed: 1, skipped: 0, durationMs: 250 });
    expect(parseVitestJson("no report", "", 1)).toMatchObject({ passed: 0, failed: 1 });
    expect(parseVitestJson("no report", "", 0)).toMatchObject({ passed: 0, failed: 0 });
  });

  it("web-app says what it can do and what it cannot yet, in plain words", () => {
    expect(webApp.capabilities?.can.join(" ")).toMatch(/Sign-in for many people/);
    expect(webApp.capabilities?.can.join(" ")).toMatch(/Photos and documents up to 4 MB/);
    expect(webApp.capabilities?.notYet.join(" ")).toMatch(/Files over 4 MB/);
    expect(renderCapabilities(webApp.capabilities!)).toMatch(/^It can:\n- [\s\S]*\nNot yet \(leave these out or work around them/);
  });

  it("names unknown profiles", () => {
    expect(() => profileFor("mobile-app")).toThrow(/not implemented yet/);
    expect(profileFor("web-app").name).toBe("web-app");
  });
});

describe("settings from .env.example", () => {
  it("reads names, notes and optional markers; hosted targets also need a real database", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readSettings, requiredSettings } = await import("../src/index.js");
    const dir = await mkdtemp(join(tmpdir(), "karigor-env-"));
    await writeFile(join(dir, ".env.example"), "# Production: libsql://<db>.turso.io\nDATABASE_URL=file:./data/local.db\n\n# The passcode the family types once\nFAMILY_PASSCODE=\n# Optional: delay after a wrong passcode\nUNLOCK_FAIL_DELAY_MS=\nexport SESSION_SECRET=\"\"\n");
    const all = await readSettings(dir);
    expect(all.map((s) => `${s.name}:${s.optional}`)).toEqual(["DATABASE_URL:false", "FAMILY_PASSCODE:false", "UNLOCK_FAIL_DELAY_MS:true", "SESSION_SECRET:false"]);
    expect(all[1]!.note).toBe("The passcode the family types once");
    expect(requiredSettings(all, false).map((s) => s.name)).toEqual(["FAMILY_PASSCODE", "SESSION_SECRET"]);
    expect(requiredSettings(all, true).map((s) => s.name)).toEqual(["DATABASE_URL", "FAMILY_PASSCODE", "SESSION_SECRET"]);
    expect(await readSettings(join(dir, "nope"))).toEqual([]);
    expect(all.map((s) => s.kind)).toEqual(["service", "ask", "ask", "generate"]);
  });

  it("takes the kind from a karigor: line, and guesses sensibly without one", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readSettings, guessKind, generateSettingValue } = await import("../src/index.js");
    const dir = await mkdtemp(join(tmpdir(), "karigor-env-"));
    await writeFile(join(dir, ".env.example"), "# The word your team types to get in\n# karigor: ask\nTEAM_WORD=\n# A hosted database\n# karigor: service turso\nDATABASE_URL=\n# Signs the cookie\n# karigor: generate\nCOOKIE_PEPPER=\n");
    expect((await readSettings(dir)).map((s) => [s.name, s.kind, s.service ?? "", s.note])).toEqual([
      ["TEAM_WORD", "ask", "", "The word your team types to get in"],
      ["DATABASE_URL", "service", "turso", "A hosted database"],
      ["COOKIE_PEPPER", "generate", "", "Signs the cookie"],
    ]);
    expect(guessKind("SESSION_SECRET", "")).toBe("generate");
    expect(guessKind("STRIPE_KEY", "")).toBe("service");
    expect(guessKind("RESEND_API_KEY", "")).toBe("service");
    expect(guessKind("FAMILY_PASSCODE", "The passcode the family types")).toBe("ask");
    expect(guessKind("TOKEN_SALT", "")).toBe("generate");
    expect(generateSettingValue()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("Playwright reports", () => {
  it("counts journeys, names failing ones with their first error line, and reports a config error", () => {
    const report = JSON.stringify({
      suites: [
        {
          title: "team.spec.ts",
          file: "team.spec.ts",
          specs: [{ title: "an admin invites a member", file: "team.spec.ts", ok: true, tests: [{ status: "expected", results: [{ status: "passed" }] }] }],
          suites: [
            {
              title: "visits",
              file: "visits.spec.ts",
              specs: [
                { title: "the receptionist books a visit", file: "visits.spec.ts", ok: false, tests: [{ status: "unexpected", results: [{ status: "failed", error: { message: "\u001b[31mError: expect(locator).toBeVisible() failed\u001b[39m\n\nLocator: getByText('Today')" } }] }] },
                { title: "skipped one", file: "visits.spec.ts", ok: true, tests: [{ status: "skipped", results: [] }] },
              ],
            },
          ],
        },
      ],
    });
    expect(parsePlaywrightJson(report)).toEqual({ passed: 1, failed: 1, failures: ["visits.spec.ts › visits › the receptionist books a visit: Error: expect(locator).toBeVisible() failed"] });
    expect(parsePlaywrightJson(JSON.stringify({ suites: [], errors: [{ message: "Error: Cannot find module '@/db'\n at x" }] }))).toEqual({ passed: 0, failed: 1, failures: ["the journeys could not start: Error: Cannot find module '@/db'"] });
    expect(parsePlaywrightJson("not json")).toEqual({ passed: 0, failed: 0, failures: [] });
  });
});
