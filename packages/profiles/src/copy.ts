import { cp, mkdir, readdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Copy a scaffold directory. Files named `_gitignore`, `_npmrc` and `_env.example` become dotfiles
 * (dotfiles inside the scaffold would otherwise be treated specially by git and npm).
 */
export async function copyScaffold(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
  const renames: [string, string][] = [["_gitignore", ".gitignore"], ["_npmrc", ".npmrc"], ["_env.example", ".env.example"]];
  for (const [a, b] of renames) {
    const p = join(to, a);
    if (await stat(p).then(() => true, () => false)) await rename(p, join(to, b));
  }
  if ((await readdir(to)).length === 0) throw new Error(`scaffold ${from} is empty`);
}
