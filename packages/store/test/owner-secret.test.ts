import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { gitCommitter, keepOwnerSecret, ownerSecret } from "../src/index.js";

const run = promisify(execFile);

describe("the owner secret Karigor keeps", () => {
  it("is readable by this user only and never enters the project's git history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-secret-"));
    await gitCommitter.init(dir);
    // a project from before the rule already tracks it
    await writeFile(join(dir, "owner-link-secret"), "old");
    await gitCommitter.commit(dir, "before");
    await keepOwnerSecret(dir, { OWNER_LINK_SECRET: "s3cret", OTHER: "x" });
    expect(await ownerSecret(dir)).toBe("s3cret");
    expect((await stat(join(dir, "owner-link-secret"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain("owner-link-secret");
    await gitCommitter.commit(dir, "after");
    expect((await run("git", ["ls-files"], { cwd: dir })).stdout).not.toContain("owner-link-secret");
  });
});
