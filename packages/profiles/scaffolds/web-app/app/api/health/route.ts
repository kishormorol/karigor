import { healthMessage } from "@/lib/health";

export function GET() {
  return Response.json({ status: healthMessage() });
}
