import { JOBS, jobsAuthorized, runDueJobs } from "@/server/jobs";

export const dynamic = "force-dynamic";

/** Called by the scheduler (Vercel Cron, or `karigor serve` on this computer); runs the jobs that are due. */
export async function GET(req: Request) {
  if (!jobsAuthorized(req.headers.get("authorization"))) return Response.json({ error: "not allowed" }, { status: 401 });
  return Response.json({ ran: await runDueJobs(JOBS) });
}
