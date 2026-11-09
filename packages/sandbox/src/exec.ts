import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** null when killed (timeout). */
  code: number | null;
  /** True when it ran out of time and was stopped. */
  timedOut?: boolean;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

const MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * Run a command and never throw on a non-zero exit; callers read `code`.
 * A command that runs out of time is stopped with everything it started (its whole process group:
 * a test runner, a browser, a server), and reported as timed out even when it then exits cleanly.
 */
export function run(cmd: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const group = process.platform !== "win32";
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env, CI: "1" }, detached: group, stdio: ["ignore", "pipe", "pipe"] });
    const stop = (signal: NodeJS.Signals) => {
      try {
        // The whole group: a package manager's children (a browser, a server) must not outlive it.
        if (group && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already gone */
      }
    };
    let hard: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      stop("SIGTERM");
      hard = setTimeout(() => stop("SIGKILL"), 5_000);
    }, timeoutMs);
    const finish = (r: ExecResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(hard);
      resolve(r);
    };
    child.stdout!.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
    });
    child.stderr!.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
    });
    child.on("error", (e) => finish({ stdout, stderr: `${stderr}\n${e.message}`, code: 127 }));
    // "exit", not "close": a stopped command's children may still hold its output open.
    child.on("exit", (code, signal) => {
      // Give the last output a moment to arrive.
      setTimeout(() => {
        if (timedOut || signal) finish({ stdout, stderr: `${stderr}\n(timed out after ${Math.round(timeoutMs / 1000)}s)`, code: null, timedOut: true });
        else finish({ stdout, stderr, code: code ?? 1 });
      }, 50);
    });
  });
}

export function clip(text: string, max = 20_000): string {
  return text.length > max ? `${text.slice(0, max)}\n... (${text.length - max} more characters)` : text;
}
