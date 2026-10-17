import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecurityFinding } from "@karigor/gates";

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI-style secret key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "Stripe live key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
];

const SKIP = /(^|\/)(node_modules|\.next|dist|build|\.git)(\/|$)|\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|pdf|lock|db)$|-lock\.(yaml|json)$|(^|\/)package-lock\.json$/;

/** Scan files for secret-shaped strings and tracked env files. */
export async function scanSecrets(dir: string, files: string[]): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];
  for (const f of files) {
    if (SKIP.test(f)) continue;
    const base = f.split("/").pop() ?? f;
    if (/^\.env(\..+)?$/.test(base)) {
      // Example env files hold placeholders by convention; real env files must never be tracked.
      if (!/\.example$|\.sample$|\.template$/.test(base)) findings.push({ severity: "critical", title: "environment file committed; keep secrets out of git", location: f });
      continue;
    }
    let text: string;
    try {
      text = await readFile(join(dir, f), "utf8");
    } catch {
      continue;
    }
    if (text.length > 2_000_000) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      if (m) {
        const line = text.slice(0, m.index).split("\n").length;
        findings.push({ severity: "critical", title: `${p.name} in source`, location: `${f}:${line}` });
        break;
      }
    }
  }
  return findings;
}
