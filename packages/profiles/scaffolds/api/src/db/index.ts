import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

export type Db = LibSQLDatabase<typeof schema>;

let real: Db | undefined;
function open(): Db {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  real ??= drizzle(createClient({ url, ...(process.env.DATABASE_AUTH_TOKEN ? { authToken: process.env.DATABASE_AUTH_TOKEN } : {}) }), { schema });
  return real;
}

/**
 * The one database handle, opened on first use: the service starts (and /health and /docs answer)
 * even before a hosted database is set up. Code that touches the database takes a `database`
 * argument defaulting to this, so tests can pass their own.
 */
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    const d = open();
    const v = Reflect.get(d, prop, d);
    return typeof v === "function" ? v.bind(d) : v;
  },
});
export { schema };
