/**
 * Uploaded files, kept in the `files` table so they work the same on this computer and when hosted,
 * with no file-storage account. For photos and documents up to MAX_UPLOAD_BYTES.
 * Larger files (videos, big scans, up to MAX_LARGE_UPLOAD_BYTES) need file storage: with the
 * BLOB_READ_WRITE_TOKEN setting, <FileField large> sends them from the browser straight to Vercel Blob
 * and the form carries only their address.
 * Save from a server action with saveUploadFrom(formData, user.id); link to /files/<id>.
 */
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { del, head } from "@vercel/blob";
import { db as defaultDb } from "@/db";
import { files } from "@/db/schema";
import type { Db } from "./people";

/** Hosting platforms refuse request bodies much over 4 MB, so uploads stay under that. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Types that are safe to keep and to show back. No HTML or SVG: a browser would run scripts in them. */
export const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "photo",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/pdf": "PDF",
  "text/plain": "text file",
  "text/csv": "spreadsheet (CSV)",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel file",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word file",
};

/** Large files go to file storage, so the 4 MB limit does not apply; this keeps one upload reasonable. */
export const MAX_LARGE_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Video is allowed for large files only, where it is kept outside the database. */
export const LARGE_ONLY_TYPES: Record<string, string> = {
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
};

/** Whether files over MAX_UPLOAD_BYTES can be kept: only with a file-storage account. */
export function largeUploadsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.BLOB_READ_WRITE_TOKEN;
}

export class UploadError extends Error {
  override name = "UploadError";
}

/** What is wrong with this upload, in plain words, or undefined when it is fine. */
export function uploadProblem(f: { size: number; type: string } | null | undefined): string | undefined {
  if (!f || f.size === 0) return "Choose a file first.";
  if (f.size > MAX_UPLOAD_BYTES) return `That file is too big. Files can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  if (!ALLOWED_TYPES[f.type]) return "That kind of file cannot be kept here. Photos, PDFs, text, CSV, Excel and Word files can.";
  return undefined;
}

/** What is wrong with a large upload, in plain words, or undefined when it is fine. */
export function largeUploadProblem(f: { size: number; type: string } | null | undefined): string | undefined {
  if (!f || f.size === 0) return "Choose a file first.";
  if (f.size > MAX_LARGE_UPLOAD_BYTES) return `That file is too big. Files can be up to ${MAX_LARGE_UPLOAD_BYTES / 1024 / 1024} MB.`;
  if (!ALLOWED_TYPES[f.type] && !LARGE_ONLY_TYPES[f.type]) return "That kind of file cannot be kept here. Photos, videos, PDFs, text, CSV, Excel and Word files can.";
  return undefined;
}

/** The most one person can add to file storage in a day, so one account cannot fill the store. */
export const MAX_LARGE_DAILY_BYTES = 1024 * 1024 * 1024;

/**
 * How many more bytes of large files this person can keep today. It counts the large files they
 * saved in the last 24 hours; a file sent to storage but never saved with its form is not counted.
 */
export async function largeUploadRoom(uploadedBy: string, database: Db = defaultDb, now = Date.now()): Promise<number> {
  const [row] = await database
    .select({ used: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(and(eq(files.uploadedBy, uploadedBy), isNotNull(files.url), gt(files.createdAt, now - 24 * 60 * 60 * 1000)));
  return Math.max(0, MAX_LARGE_DAILY_BYTES - Number(row?.used ?? 0));
}

/** What file storage says about a file it holds; `head` from @vercel/blob in the app, a stand-in in tests. */
export type BlobLookup = (url: string) => Promise<{ size: number; contentType: string; pathname: string }>;

/** Takes a file out of file storage; `del` from @vercel/blob in the app, a stand-in in tests. */
export type BlobRemove = (url: string) => Promise<void>;

/** Removing from storage must not break the page: a file left behind costs space, not correctness. */
const removeFromStorage: BlobRemove = async (url) => {
  try {
    await del(url);
  } catch (e) {
    console.error(`could not remove ${url} from file storage: ${(e as Error).message}`);
  }
};

/**
 * Keep a record of a large file the browser already sent to file storage; returns its id. The address
 * is checked with file storage itself (with this app's own key), so a form cannot pass off someone
 * else's file or one bigger or of another kind than allowed. A file that is refused for its size,
 * kind or the day's limit is taken out of storage again; one already kept is never touched.
 */
export async function saveLargeUpload(
  url: string,
  uploadedBy: string | null,
  database: Db = defaultDb,
  lookup: BlobLookup = (u) => head(u),
  now = Date.now(),
  remove: BlobRemove = removeFromStorage,
): Promise<string> {
  let info: Awaited<ReturnType<BlobLookup>>;
  try {
    // Uploads are sent with public access, which is also what /files/<id> can send people to.
    if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(url)) throw new Error("not a file-storage address");
    const [kept] = await database.select({ id: files.id }).from(files).where(eq(files.url, url)).limit(1);
    if (kept) throw new Error("already kept");
    info = await lookup(url);
  } catch {
    throw new UploadError("That file did not arrive. Please choose it again.");
  }
  let problem = largeUploadProblem({ size: info.size, type: info.contentType });
  if (!problem && uploadedBy && info.size > (await largeUploadRoom(uploadedBy, database, now))) problem = "You have added a lot of large files today. Please try again tomorrow.";
  if (problem) {
    await remove(url);
    throw new UploadError(problem);
  }
  const id = crypto.randomUUID();
  const name = (info.pathname.split("/").pop() ?? "file").replace(/-[A-Za-z0-9]{20,}(?=\.[^.]+$|$)/, "").replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "file";
  await database.insert(files).values({ id, name, type: info.contentType, size: info.size, data: Buffer.alloc(0), url, uploadedBy, createdAt: now });
  return id;
}

/**
 * Keep whatever the form sent from a <FileField>: a large file's address (`fileUrl`) when the browser
 * sent the file to file storage, otherwise the file itself (`file`). Returns the new file's id.
 */
export async function saveUploadFrom(form: FormData, uploadedBy: string | null, database: Db = defaultDb, lookup?: BlobLookup): Promise<string> {
  const url = form.get("fileUrl");
  if (typeof url === "string" && url) return saveLargeUpload(url, uploadedBy, database, lookup);
  return saveUpload(form.get("file") as File | null, uploadedBy, database);
}

/** Keep an uploaded file; returns its id. Throws UploadError with a plain message when it cannot be kept. */
export async function saveUpload(file: File | null | undefined, uploadedBy: string | null, database: Db = defaultDb, now = Date.now()): Promise<string> {
  const problem = uploadProblem(file);
  if (problem || !file) throw new UploadError(problem ?? "Choose a file first.");
  const id = crypto.randomUUID();
  const name = file.name.replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "file";
  await database.insert(files).values({ id, name, type: file.type, size: file.size, data: Buffer.from(await file.arrayBuffer()), uploadedBy, createdAt: now });
  return id;
}

export async function getFile(id: string, database: Db = defaultDb) {
  const [f] = await database.select().from(files).where(eq(files.id, id)).limit(1);
  return f;
}

/** Remove a kept file; a large one is also taken out of file storage. */
export async function deleteFile(id: string, database: Db = defaultDb, remove: BlobRemove = removeFromStorage): Promise<void> {
  const [f] = await database.select({ url: files.url }).from(files).where(eq(files.id, id)).limit(1);
  await database.delete(files).where(eq(files.id, id));
  if (f?.url) await remove(f.url);
}

/**
 * The response that shows or downloads a file: images open in the page, everything else downloads.
 * A large file is sent from file storage: its address is long and random, and only signed-in people
 * are sent to it, but anyone handed that exact address could open it.
 */
export function fileResponse(f: { name: string; type: string; data: Buffer; url?: string | null }): Response {
  if (f.url) return new Response(null, { status: 302, headers: { location: f.url, "cache-control": "private, no-store" } });
  const inline = f.type.startsWith("image/") || f.type === "application/pdf";
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.type,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${f.name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}
