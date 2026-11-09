import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/exec.js";

describe("running a command", () => {
  it("reports a timeout even when the stopped command then exits cleanly, and stops what it started", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-exec-"));
    // A parent that exits 0 when stopped, with a child that would keep running: what pnpm does around a test runner.
    const script = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      require("node:fs").writeFileSync("child.pid", String(child.pid));
      process.on("SIGTERM", () => process.exit(0));
      setInterval(() => {}, 1000);`;
    const t = Date.now();
    const r = await run(process.execPath, ["-e", script], { cwd: dir, timeoutMs: 800 });
    expect(r.timedOut).toBe(true);
    expect(r.code).toBeNull();
    expect(Date.now() - t).toBeLessThan(8_000);
    const pid = Number(readFileSync(join(dir, "child.pid"), "utf8"));
    await new Promise((res) => setTimeout(res, 300));
    const alive = (() => { try { process.kill(pid, 0); return true; } catch { return false; } })();
    expect(alive).toBe(false);
  });

  it("returns the exit code and output otherwise", async () => {
    const r = await run(process.execPath, ["-e", "console.log('hi'); process.exit(3)"], { cwd: tmpdir() });
    expect(r).toMatchObject({ code: 3, stdout: "hi\n" });
    expect(r.timedOut).toBeUndefined();
  });
});
