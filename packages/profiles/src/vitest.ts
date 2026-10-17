import type { TestCounts } from "./types.js";

/** Parse the Vitest JSON reporter (last JSON object in stdout). Falls back to the exit code. */
export function parseVitestJson(stdout: string, _stderr: string, exitCode: number | null): TestCounts {
  const objects = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(objects[i]!) as { numPassedTests?: number; numFailedTests?: number; numPendingTests?: number; numTotalTests?: number; startTime?: number; testResults?: { endTime?: number }[] };
      if (typeof j.numTotalTests === "number") {
        const end = Math.max(0, ...(j.testResults ?? []).map((t) => t.endTime ?? 0));
        return {
          passed: j.numPassedTests ?? 0,
          failed: j.numFailedTests ?? 0,
          skipped: j.numPendingTests ?? 0,
          durationMs: j.startTime && end ? Math.max(0, end - j.startTime) : 0,
        };
      }
    } catch {
      /* not the report */
    }
  }
  return { passed: 0, failed: exitCode === 0 ? 0 : 1, skipped: 0, durationMs: 0 };
}
