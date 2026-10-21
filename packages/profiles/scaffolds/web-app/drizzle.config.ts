import { defineConfig } from "drizzle-kit";

// "turso" speaks to both a local file (file:...) and a hosted database (libsql://...).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:./data/app.db",
    ...(process.env.DATABASE_AUTH_TOKEN ? { authToken: process.env.DATABASE_AUTH_TOKEN } : {}),
  },
});
