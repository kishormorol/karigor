import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { currentUser } from "@/server/auth";
import { ALLOWED_TYPES, LARGE_ONLY_TYPES, MAX_LARGE_UPLOAD_BYTES, largeUploadRoom, largeUploadsEnabled } from "@/server/files";

export const dynamic = "force-dynamic";

/**
 * Lets a signed-in person's browser send one large file straight to file storage (Vercel Blob), so it
 * never passes through the app and the hosting limit of about 4 MB per request does not apply.
 * The form then carries only the file's address; saveUploadFrom checks it with file storage.
 */
export async function POST(req: Request): Promise<Response> {
  if (!largeUploadsEnabled()) return Response.json({ error: "Large files are not set up for this app." }, { status: 404 });
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if ((await largeUploadRoom(user.id)) <= 0) return Response.json({ error: "You have added a lot of large files today. Please try again tomorrow." }, { status: 429 });
  try {
    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [...Object.keys(ALLOWED_TYPES), ...Object.keys(LARGE_ONLY_TYPES)],
        maximumSizeInBytes: MAX_LARGE_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
