import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Database tables. Add one `sqliteTable` per kind of thing the service stores.
 * Use text ids (crypto.randomUUID()) and integer timestamps in milliseconds.
 */

/** Programs allowed to call the service. Only a hash of each key is stored; the key itself is shown once. */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    /** Who or what uses it, in the owner's words ("Shop app", "Rina's phone"). */
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    /** The first characters, so the owner can tell keys apart. */
    preview: text("preview").notNull(),
    /** A key of SCOPES in src/lib/access.ts. */
    scope: text("scope").notNull().default("full"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("api_keys_active_idx").on(t.active)],
);

/** One row per call, so the owner can see who uses the service and what failed. Kept 30 days. */
export const requestLog = sqliteTable(
  "request_log",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    ms: integer("ms").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("request_log_at_idx").on(t.at)],
);
