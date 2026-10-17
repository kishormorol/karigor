/**
 * What the gate engine needs from the place where project code lives.
 * The kernel ships only a fake; sub-project 3 adds Docker.
 */
export interface TestRun {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  output: string;
}
export interface CommandResult {
  ok: boolean;
  output: string;
}
export interface SecurityFinding {
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  location?: string;
}
export interface ScanResult {
  findings: SecurityFinding[];
  output: string;
}
export interface UrlCheck {
  ok: boolean;
  status: number;
  output: string;
}

export interface Sandbox {
  runTests(itemId?: string): Promise<TestRun>;
  lint(): Promise<CommandResult>;
  build(): Promise<CommandResult>;
  securityScan(): Promise<ScanResult>;
  checkUrl(url: string): Promise<UrlCheck>;
  verifyRollback(): Promise<CommandResult>;
  /** Unified diff of the work done for an item (or everything since the phase began). */
  diff(itemId?: string): Promise<string>;
}

export type FakeSandboxScript = Partial<{
  tests: (itemId?: string) => Partial<TestRun>;
  lint: Partial<CommandResult>;
  build: Partial<CommandResult>;
  scan: Partial<ScanResult>;
  url: (url: string) => Partial<UrlCheck>;
  rollback: Partial<CommandResult>;
  diff: (itemId?: string) => string;
}>;

/** Scripted sandbox for the kernel's own tests. Everything passes unless the script says otherwise. */
export class FakeSandbox implements Sandbox {
  readonly calls: string[] = [];
  constructor(private readonly script: FakeSandboxScript = {}) {}
  async runTests(itemId?: string): Promise<TestRun> {
    this.calls.push(`runTests:${itemId ?? ""}`);
    return { suite: "unit", passed: 3, failed: 0, skipped: 0, durationMs: 120, output: "3 passed", ...this.script.tests?.(itemId) };
  }
  async lint(): Promise<CommandResult> {
    this.calls.push("lint");
    return { ok: true, output: "clean", ...this.script.lint };
  }
  async build(): Promise<CommandResult> {
    this.calls.push("build");
    return { ok: true, output: "built", ...this.script.build };
  }
  async securityScan(): Promise<ScanResult> {
    this.calls.push("securityScan");
    return { findings: [], output: "0 findings", ...this.script.scan };
  }
  async checkUrl(url: string): Promise<UrlCheck> {
    this.calls.push(`checkUrl:${url}`);
    return { ok: true, status: 200, output: "200 OK", ...this.script.url?.(url) };
  }
  async verifyRollback(): Promise<CommandResult> {
    this.calls.push("verifyRollback");
    return { ok: true, output: "rollback dry run ok", ...this.script.rollback };
  }
  async diff(itemId?: string): Promise<string> {
    this.calls.push(`diff:${itemId ?? ""}`);
    return this.script.diff?.(itemId) ?? `--- a/src/${itemId ?? "all"}.ts\n+++ b/src/${itemId ?? "all"}.ts\n+export const done = true;\n`;
  }
}
