import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Tests make `karigor-*` directories (projects, workspaces, releases) in the temp dir; remove this run's. */
export default function setup() {
  const started = Date.now();
  return async function teardown() {
    const dir = tmpdir();
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.startsWith("karigor-")) continue;
      const p = join(dir, name);
      const s = await stat(p).catch(() => undefined);
      if (s && s.birthtimeMs >= started - 1000) await rm(p, { recursive: true, force: true }).catch(() => {});
    }
  };
}
