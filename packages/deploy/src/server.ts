import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { checkUrl } from "@karigor/sandbox";

/** A release started as a long-running process. */
export class RunningServer {
  private out = "";
  private exited: number | null | undefined = undefined;
  private readonly listeners: ((line: string) => void)[] = [];
  private partial = "";

  constructor(
    private readonly child: ChildProcess,
    readonly port: number,
    readonly url: string,
  ) {
    const take = (b: Buffer) => {
      const text = b.toString("utf8");
      this.out = (this.out + text).slice(-20_000);
      this.partial += text;
      const lines = this.partial.split("\n");
      this.partial = lines.pop() ?? "";
      for (const l of lines) for (const f of this.listeners) f(l);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("exit", (code) => {
      this.exited = code;
    });
  }

  get output(): string {
    return this.out;
  }

  get alive(): boolean {
    return this.exited === undefined;
  }

  /** Every complete line the process prints, from now on. */
  onLine(f: (line: string) => void): void {
    this.listeners.push(f);
  }

  /** Poll `path` until it answers below 400, the process exits, or time runs out. */
  async waitHealthy(path: string, timeoutMs: number): Promise<{ ok: boolean; output: string }> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      if (!this.alive) return { ok: false, output: `the app stopped (exit ${this.exited}) before it answered:\n${this.out.slice(-3000)}` };
      const r = await checkUrl(`${this.url}${path}`, undefined, 5_000);
      if (r.ok) return { ok: true, output: `${this.url}${path} answered ${r.status}` };
      last = `${r.status}: ${r.output}`;
      if (r.status >= 400) return { ok: false, output: `${this.url}${path} answered ${last}\n${this.out.slice(-3000)}` };
      await new Promise((res) => setTimeout(res, 250));
    }
    return { ok: false, output: `${this.url}${path} did not answer within ${Math.round(timeoutMs / 1000)}s (${last})\n${this.out.slice(-3000)}` };
  }

  /** Stop the whole process group, politely first. */
  async stop(): Promise<void> {
    if (!this.alive || this.child.pid === undefined) return;
    const pid = this.child.pid;
    const kill = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          this.child.kill(sig);
        } catch {
          /* already gone */
        }
      }
    };
    const gone = new Promise<void>((res) => this.child.once("exit", () => res()));
    kill("SIGTERM");
    const timer = new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 5_000));
    if ((await Promise.race([gone, timer])) === "timeout") {
      kill("SIGKILL");
      await Promise.race([gone, new Promise((res) => setTimeout(res, 2_000))]);
    }
  }
}

/** Start `argv` in `cwd` with `PORT` set, in its own process group so it can be stopped as a whole. */
export function startServer(argv: string[], cwd: string, port: number, env: NodeJS.ProcessEnv = {}): RunningServer {
  const [cmd, ...args] = argv;
  const child = spawn(cmd!, args, {
    cwd,
    env: { ...process.env, NODE_ENV: "production", ...env, PORT: String(port) },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", () => {
    /* reported through exit and waitHealthy */
  });
  return new RunningServer(child, port, `http://127.0.0.1:${port}`);
}

/** A port nothing is listening on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}
