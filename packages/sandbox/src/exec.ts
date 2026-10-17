import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** null when killed (timeout). */
  code: number | null;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Run a command and never throw on a non-zero exit; callers read `code`. */
export function run(cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...opts.env, CI: "1" } }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: unknown; killed?: boolean; signal?: string }) | null;
      if (e?.killed || e?.signal) {
        resolve({ stdout: String(stdout), stderr: `${String(stderr)}\n(timed out after ${Math.round((opts.timeoutMs ?? 600000) / 1000)}s)`, code: null });
        return;
      }
      if (e && typeof e.code !== "number") {
        resolve({ stdout: String(stdout), stderr: `${String(stderr)}\n${e.message}`, code: 127 });
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr), code: e ? (e.code as number) : 0 });
    });
  });
}

export function clip(text: string, max = 20_000): string {
  return text.length > max ? `${text.slice(0, max)}\n... (${text.length - max} more characters)` : text;
}
