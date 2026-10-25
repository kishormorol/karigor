import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * How a setting gets its value, without a technical question:
 * - `generate`: a secret nobody needs to know (a signing key); Karigor makes one.
 * - `ask`: a product choice only the person can make (the family passcode); asked in plain words.
 * - `service`: a connection to an outside service that needs its own account (a hosted database).
 */
export type SettingKind = "generate" | "ask" | "service";

/** One setting the app reads from its environment, as documented in `.env.example`. */
export interface Setting {
  name: string;
  /** The example's value: empty means the person must supply one. */
  example: string;
  /** The comment lines above it, in the developer's words. */
  note: string;
  /** The same note in Bangla, from a `# bn: …` comment line, for a person who reads Bangla. */
  noteBn?: string;
  optional: boolean;
  kind: SettingKind;
  /** For `service`: which service, when the developer named it. */
  service?: string;
}

/** A setting the live app still lacks, as the person and the UI see it. */
export interface MissingSetting {
  name: string;
  note: string;
  noteBn?: string;
  kind: SettingKind;
  service?: string;
}

const GENERATE_NAME = /(SECRET|SALT|SIGNING_KEY|ENCRYPTION_KEY|COOKIE_KEY|JWT_KEY|SESSION_KEY)$/;
const SERVICE_NAME = /^(DATABASE_|DB_|REDIS_|POSTGRES|TURSO_|SUPABASE_|NEON_|SMTP_|STRIPE_|RESEND_|SENDGRID_|TWILIO_)|_(API_KEY|AUTH_TOKEN|DSN)$/;

/** The kind of a setting with no annotation: a best guess from its name and note. */
export function guessKind(name: string, note: string): SettingKind {
  if (GENERATE_NAME.test(name) || /\brandom\b/i.test(note)) return "generate";
  if (SERVICE_NAME.test(name) || /\b(turso|supabase|neon|stripe|smtp|api key)\b/i.test(note)) return "service";
  return "ask";
}

/**
 * Settings documented in the workspace's `.env.example`. A comment line
 * `karigor: generate`, `karigor: ask` or `karigor: service <name>` states the kind;
 * otherwise it is guessed.
 */
export async function readSettings(dir: string): Promise<Setting[]> {
  const text = await readFile(join(dir, ".env.example"), "utf8").catch(() => "");
  const out: Setting[] = [];
  let note: string[] = [];
  let noteBn: string[] = [];
  let kind: { kind: SettingKind; service?: string } | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      note = [];
      noteBn = [];
      kind = undefined;
      continue;
    }
    if (line.startsWith("#")) {
      const c = line.replace(/^#+\s?/, "");
      const k = /^karigor:\s*(generate|ask|service)\b\s*(.*)$/i.exec(c);
      const bn = /^bn:\s*(.*)$/i.exec(c);
      if (k) kind = { kind: k[1]!.toLowerCase() as SettingKind, ...(k[2]?.trim() ? { service: k[2].trim() } : {}) };
      else if (bn) noteBn.push(bn[1]!);
      else note.push(c);
      continue;
    }
    const m = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) {
      const example = m[2]!.replace(/^["']|["']$/g, "");
      const n = note.join(" ");
      out.push({ name: m[1]!, example, note: n, ...(noteBn.length ? { noteBn: noteBn.join(" ") } : {}), optional: /^optional\b/i.test(n), ...(kind ?? { kind: guessKind(m[1]!, n) }) });
    }
    note = [];
    noteBn = [];
    kind = undefined;
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

export function toMissing(s: Setting): MissingSetting {
  return { name: s.name, note: s.note, ...(s.noteBn ? { noteBn: s.noteBn } : {}), kind: s.kind, ...(s.service ? { service: s.service } : {}) };
}

/** Settings every deploy target provides itself; the person is never asked for them. */
export const TARGET_SETTINGS = ["SITE_URL"] as const;

/** A value for a `generate` setting: 32 random bytes, URL-safe. */
export function generateSettingValue(): string {
  return randomBytes(32).toString("base64url");
}
