import { requireUser } from "@/server/auth";
import { fileResponse, getFile } from "@/server/files";

/** A kept file, for signed-in people only. Pages that show files to fewer roles check their permission first and link here. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const f = await getFile((await params).id);
  if (!f) return new Response("Not found", { status: 404 });
  return fileResponse(f);
}
