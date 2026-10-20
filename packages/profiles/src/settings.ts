import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** One setting the app reads from its environment, as documented in `.env.example`. */
export interface Setting {
  name: string;
  /** The example's value: empty means the person must supply one. */
  example: string;
  /** The comment lines above it, in the developer's words. */
  note: string;
  optional: boolean;
}

/** Settings documented in the workspace's `.env.example` (the stack guide requires new ones to be listed there). */
export async function readSettings(dir: string): Promise<Setting[]> {
  const text = await readFile(join(dir, ".env.example"), "utf8").catch(() => "");
  const out: Setting[] = [];
  let note: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      note = [];
      continue;
    }
    if (line.startsWith("#")) {
      note.push(line.replace(/^#+\s?/, ""));
      continue;
    }
    const m = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) {
      const example = m[2]!.replace(/^["']|["']$/g, "");
      out.push({ name: m[1]!, example, note: note.join(" "), optional: /^optional\b/i.test(note.join(" ")) });
    }
    note = [];
  }
  return out;
}

/**
 * Settings a hosted release cannot run without: every non-optional one with no example value,
 * and any whose example points at a local file (a database on this computer does not travel).
 */
export function requiredSettings(all: Setting[], hosted: boolean): Setting[] {
  return all.filter((s) => !s.optional && (s.example === "" || (hosted && s.example.startsWith("file:"))));
}
