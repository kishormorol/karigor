/**
 * Uploaded files, kept in the `files` table so they work the same on this computer and when hosted,
 * with no file-storage account. For photos and documents up to MAX_UPLOAD_BYTES.
 * Save from a server action with saveUpload(formData.get("file"), user.id); link to /files/<id>.
 */
import { eq } from "drizzle-orm";
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

export async function deleteFile(id: string, database: Db = defaultDb): Promise<void> {
  await database.delete(files).where(eq(files.id, id));
}

/** The response that shows or downloads a file: images open in the page, everything else downloads. */
export function fileResponse(f: { name: string; type: string; data: Buffer }): Response {
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
