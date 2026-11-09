import { lt } from "drizzle-orm";
import { db as defaultDb, type Db } from "../db/index.js";
import { requestLog } from "../db/schema.js";

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Record one call. Never throws: a full log must not stop the service. */
export async function logRequest(r: { keyId?: string; method: string; path: string; status: number; ms: number }, database: Db = defaultDb): Promise<void> {
  try {
    const at = Date.now();
    await database.insert(requestLog).values({ id: crypto.randomUUID(), keyId: r.keyId ?? null, method: r.method, path: r.path.slice(0, 300), status: r.status, ms: Math.round(r.ms), at });
    // Now and then, forget calls older than 30 days.
    if (Math.random() < 0.01) await database.delete(requestLog).where(lt(requestLog.at, at - KEEP_MS));
  } catch (e) {
    console.error("request log:", (e as Error).message);
  }
}
