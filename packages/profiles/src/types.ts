import type { TargetProfile } from "@karigor/store";

export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface ProfileCommands {
  /** Run once after scaffolding. Omit when nothing needs installing. */
  install?: string[];
  /** Must print something `parseTests` understands. */
  test: string[];
  lint?: string[];
  build?: string[];
  /** Dependency audit; prints JSON. Omit to skip. */
  audit?: string[];
  /** Serve a built release. Run with `PORT` set; must keep running. Omit when the profile cannot be served. */
  start?: string[];
}

export interface Profile {
  name: TargetProfile | "fixture";
  description: string;
  /** Copy the scaffold into an empty directory. */
  scaffold(dir: string): Promise<void>;
  commands: ProfileCommands;
  parseTests(stdout: string, stderr: string, exitCode: number | null): TestCounts;
  /** Markdown the architect and developer read: conventions, where things go, how to test. */
  stackGuide: string;
  /** Path a running release answers with a 2xx when it is healthy. */
  healthPath?: string;
  /** Settings with a sensible value on this computer (a local database file); never asked for on the local target. */
  localSettings?: Record<string, string>;
}
