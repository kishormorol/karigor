import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Something that records a snapshot of the project directory after a write. */
export interface Committer {
  init(dir: string): Promise<void>;
  commit(dir: string, message: string): Promise<void>;
}

export const noopCommitter: Committer = {
  async init() {},
  async commit() {},
};

/** Commits the project directory with git. Each event batch becomes one commit. */
export const gitCommitter: Committer = {
  async init(dir) {
    await run("git", ["init", "-q", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.name", "karigor"], { cwd: dir });
    await run("git", ["config", "user.email", "karigor@localhost"], { cwd: dir });
  },
  async commit(dir, message) {
    await run("git", ["add", "-A"], { cwd: dir });
    const { stdout } = await run("git", ["status", "--porcelain"], { cwd: dir });
    if (stdout.trim() === "") return;
    await run("git", ["commit", "-q", "-m", message], { cwd: dir });
  },
};
