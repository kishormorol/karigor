import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";
const client = createClient({ url, ...(process.env.DATABASE_AUTH_TOKEN ? { authToken: process.env.DATABASE_AUTH_TOKEN } : {}) });

/** The one database handle. Import from server code only (route handlers, server actions, server components). */
export const db = drizzle(client, { schema });
export { schema };
