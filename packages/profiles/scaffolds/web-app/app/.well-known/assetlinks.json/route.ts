import { assetLinks } from "@/lib/app-links";

export const dynamic = "force-dynamic";

/** Android reads this to trust the app's phone app (see src/lib/app-links.ts). */
export function GET() {
  return Response.json(assetLinks(), { headers: { "cache-control": "public, max-age=3600" } });
}
