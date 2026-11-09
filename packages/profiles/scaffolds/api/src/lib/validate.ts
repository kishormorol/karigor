import type { Context } from "hono";
import { z } from "zod";

export class BadRequest extends Error {}

/** The JSON body, checked against `schema`. A body that does not fit becomes a 400 with the reason in plain words. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => undefined);
  if (raw === undefined) throw new BadRequest("the body must be JSON");
  const r = schema.safeParse(raw);
  if (!r.success) throw new BadRequest(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}
