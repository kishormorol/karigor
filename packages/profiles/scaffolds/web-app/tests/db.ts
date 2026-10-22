import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/server/people";

/** A fresh in-memory database with every migration applied, for one test. */
export async function testDb(): Promise<Db> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Db;
}
