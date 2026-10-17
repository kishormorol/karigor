import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Database tables. Add one `sqliteTable` per kind of thing the app stores.
 * Use text ids (crypto.randomUUID()) and integer timestamps in milliseconds.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
