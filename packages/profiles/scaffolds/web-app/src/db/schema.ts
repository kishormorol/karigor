import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Database tables. Add one `sqliteTable` per kind of thing the app stores.
 * Use text ids (crypto.randomUUID()) and integer timestamps in milliseconds.
 * The people tables below come with the template; build on them rather than adding another login.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Everyone who can sign in. `role` is a key of ROLES in src/lib/access.ts. No password until they open their invite link. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Stored lower-case. */
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  passwordHash: text("password_hash"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Signed-in browsers. Only a hash of the cookie value is stored. */
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Failed sign-ins per email and address, so guessing passwords is slow. */
export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull(),
  windowStart: integer("window_start").notNull(),
});

/** One-time links to set a password: an invitation, or a reset made by an admin. Only a hash is stored. */
export const accessLinks = sqliteTable("access_links", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["invite", "reset"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdBy: text("created_by"),
});

/** Who did what, newest last. Written with logActivity(); shown to admins. */
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    /** Plain words, past tense: "invited Rina as Receptionist". */
    action: text("action").notNull(),
    /** What it was about, for filtering: "people", "visits", ... */
    subject: text("subject"),
    at: integer("at").notNull(),
  },
  (t) => [index("activity_at_idx").on(t.at)],
);

/** Every email and SMS the app tried to send, sent or not, newest last. Written by src/server/messages.ts. */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    channel: text("channel", { enum: ["email", "sms"] }).notNull(),
    to: text("to").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    /** sent; not-sent (no service set up yet); failed (the service refused it). */
    status: text("status", { enum: ["sent", "not-sent", "failed"] }).notNull(),
    /** Why it was not sent, in plain words, or the service's message id. */
    detail: text("detail"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("messages_created_idx").on(t.createdAt)],
);

/** Uploaded files, kept in the database itself so they work on this computer and when hosted. Written by src/server/files.ts. */
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  uploadedBy: text("uploaded_by"),
  createdAt: integer("created_at").notNull(),
});

/** When each scheduled job last ran. Written by src/server/jobs.ts. */
export const jobRuns = sqliteTable("job_runs", {
  name: text("name").primaryKey(),
  lastRunAt: integer("last_run_at").notNull(),
  /** "ok" or the error, in a line. */
  result: text("result").notNull(),
});
