import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "../src/db/schema.js";
import type { Db } from "../src/db/index.js";

/** A fresh in-memory database with every migration applied, for one test. */
export async function testDb(): Promise<Db> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
