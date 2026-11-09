import { execFile } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ignoreInProjectGit } from "./lock.js";

/**
 * The one setting value Karigor keeps: the key a hosted app accepts when Karigor asks it for the owner's
 * first sign-in link. Every other value lives only where the app runs. Kept readable by this user alone.
 */
export const OWNER_LINK_SETTING = "OWNER_LINK_SECRET";
const FILE = "owner-link-secret";

export async function keepOwnerSecret(projectDir: string, values: Record<string, string>): Promise<void> {
  const v = values[OWNER_LINK_SETTING];
  if (!v) return;
  // Before writing: the project directory is committed with `git add -A`, and a secret must never enter its history.
  await ignoreInProjectGit(projectDir, [FILE]);
  // A project from before this rule may already track it; stop tracking (the file itself stays).
  await new Promise<void>((done) => execFile("git", ["rm", "--cached", "-q", "--ignore-unmatch", FILE], { cwd: projectDir }, () => done()));
  await writeFile(join(projectDir, FILE), v, { mode: 0o600 });
  // `mode` applies only when the file is new.
  await chmod(join(projectDir, FILE), 0o600);
}

export async function ownerSecret(projectDir: string): Promise<string | undefined> {
  const v = (await readFile(join(projectDir, FILE), "utf8").catch(() => "")).trim();
  return v || undefined;
}
