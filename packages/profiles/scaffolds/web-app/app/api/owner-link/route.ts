import { ownerLink, ownerLinkAuthorized } from "@/server/owner-link";

export const dynamic = "force-dynamic";

/** Karigor asks here for the owner's one-time link to choose a password (see src/server/owner-link.ts). */
export async function POST(req: Request) {
  if (!ownerLinkAuthorized(req.headers.get("authorization"))) return Response.json({ error: "not allowed" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; name?: unknown };
  const r = await ownerLink(body, process.env.SITE_URL || new URL(req.url).origin);
  return Response.json(r, { status: "error" in r ? 400 : 200 });
}
