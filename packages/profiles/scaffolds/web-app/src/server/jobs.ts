/**
 * Work that runs on a schedule by itself (a morning reminder, a nightly clean-up).
 * Add a job to JOBS; GET /api/jobs runs every job that is due. Hosted on Vercel's free plan it is
 * called once a day (vercel.json), and every few minutes while `karigor watch --every` runs; on this
 * computer `karigor serve` calls it every few minutes.
 * So a job must be safe to run late and to run again: check what is already done before doing it.
 */
import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { jobRuns } from "@/db/schema";
import type { Db } from "./people";

const HOUR_MS = 60 * 60 * 1000;
export const PERIOD_MS = { hour: HOUR_MS, day: 24 * HOUR_MS } as const;

export interface Job {
  /** Stable name: it keys the last run. */
  name: string;
  /** How often it should run at most. Hosted on the free plan, "hour" jobs run hourly only while `karigor watch --every` runs. */
  every: keyof typeof PERIOD_MS;
  run(database: Db, now: number): Promise<void>;
}

/** The app's scheduled jobs. Empty until an item needs one. */
export const JOBS: Job[] = [];

export interface JobReport {
  name: string;
  result: "ok" | "skipped" | string;
}

/** Run every job that is due. One failing job never stops the others; each result is kept in `job_runs`. */
export async function runDueJobs(jobs: Job[] = JOBS, database: Db = defaultDb, now = Date.now()): Promise<JobReport[]> {
  const out: JobReport[] = [];
  for (const job of jobs) {
    const [last] = await database.select().from(jobRuns).where(eq(jobRuns.name, job.name)).limit(1);
    // A little slack so a daily call that arrives a few minutes early still runs a daily job.
    if (last && now - last.lastRunAt < PERIOD_MS[job.every] - 10 * 60 * 1000) {
      out.push({ name: job.name, result: "skipped" });
      continue;
    }
    let result = "ok";
    try {
      await job.run(database, now);
    } catch (e) {
      result = `failed: ${(e as Error).message}`.slice(0, 300);
    }
    await database.insert(jobRuns).values({ name: job.name, lastRunAt: now, result }).onConflictDoUpdate({ target: jobRuns.name, set: { lastRunAt: now, result } });
    out.push({ name: job.name, result });
  }
  return out;
}

/**
 * Only a scheduler may run jobs: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`, and Karigor
 * (`karigor watch`) sends its OWNER_LINK_SECRET, a key that can already do more than this.
 */
export function jobsAuthorized(
  authorization: string | null,
  secrets: string | undefined | (string | undefined)[] = [process.env.CRON_SECRET, process.env.OWNER_LINK_SECRET],
): boolean {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter((s): s is string => !!s);
  return !!authorization && list.some((s) => authorization === `Bearer ${s}`);
}
