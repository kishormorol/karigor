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

  /** The port the app says it listens on, when that is not the one it was given. */
  private otherPort(): number | undefined {
    for (const m of this.out.matchAll(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/g)) {
      const p = Number(m[1]);
      if (p !== this.port) return p;
    }
    return undefined;
  }

  /** Poll `path` until it answers below 400, the process exits, or time runs out. */
  async waitHealthy(path: string, timeoutMs: number): Promise<{ ok: boolean; output: string }> {
    const started = Date.now();
    const deadline = started + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      if (!this.alive) return { ok: false, output: `the app stopped (exit ${this.exited}) before it answered:\n${this.out.slice(-3000)}` };
      const r = await checkUrl(`${this.url}${path}`, undefined, 5_000);
      if (r.ok) return { ok: true, output: `${this.url}${path} answered ${r.status}` };
      last = `${r.status}: ${r.output}`;
      if (r.status >= 400) return { ok: false, output: `${this.url}${path} answered ${last}\n${this.out.slice(-3000)}` };
      // An app that announced another port will never answer on this one: say so without waiting out the clock.
      const other = this.otherPort();
      if (other !== undefined && Date.now() - started > Math.min(10_000, timeoutMs / 2)) return { ok: false, output: `${wrongPort(other, this.port)}\n${this.out.slice(-3000)}` };
      await new Promise((res) => setTimeout(res, 250));
    }
    const other = this.otherPort();
    return { ok: false, output: `${other !== undefined ? `${wrongPort(other, this.port)}\n` : ""}${this.url}${path} did not answer within ${Math.round(timeoutMs / 1000)}s (${last})\n${this.out.slice(-3000)}` };
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

const wrongPort = (other: number, given: number) =>
  `the app started on port ${other}, not on the port it was given (PORT=${given}): its start command or its code fixes the port. Karigor chooses the port for every preview and release, so the app must listen on the PORT setting (for example a plain \`next start\`, with no -p).`;

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
