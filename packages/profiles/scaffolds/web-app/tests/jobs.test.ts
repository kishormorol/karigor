import { describe, expect, it } from "vitest";
import { GET } from "../app/api/jobs/route";
import { PERIOD_MS, jobsAuthorized, runDueJobs, type Job } from "@/server/jobs";
import { testDb } from "./db";

const T = 1_800_000_000_000;

describe("scheduled jobs", () => {
  it("runs a job when due, skips it until its period has passed, and keeps the result", async () => {
    const db = await testDb();
    let runs = 0;
    const job: Job = { name: "remind", every: "day", run: async () => void runs++ };
    expect(await runDueJobs([job], db, T)).toEqual([{ name: "remind", result: "ok" }]);
    expect(await runDueJobs([job], db, T + PERIOD_MS.hour)).toEqual([{ name: "remind", result: "skipped" }]);
    // a daily call a few minutes early still counts as the next day
    expect(await runDueJobs([job], db, T + PERIOD_MS.day - 5 * 60 * 1000)).toEqual([{ name: "remind", result: "ok" }]);
    expect(runs).toBe(2);
  });

  it("one failing job does not stop the others", async () => {
    const db = await testDb();
    const ran: string[] = [];
    const jobs: Job[] = [
      { name: "broken", every: "hour", run: async () => { throw new Error("no network"); } },
      { name: "fine", every: "hour", run: async () => void ran.push("fine") },
    ];
    expect(await runDueJobs(jobs, db, T)).toEqual([{ name: "broken", result: "failed: no network" }, { name: "fine", result: "ok" }]);
    expect(ran).toEqual(["fine"]);
  });

  it("only the scheduler, with the secret, may start jobs", async () => {
    expect(jobsAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(jobsAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(jobsAuthorized(null, "s3cret")).toBe(false);
    expect(jobsAuthorized("Bearer ", undefined)).toBe(false);
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret";
    try {
      expect((await GET(new Request("http://x/api/jobs"))).status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
