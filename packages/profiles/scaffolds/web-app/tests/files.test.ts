import { describe, expect, it } from "vitest";
import { MAX_LARGE_DAILY_BYTES, MAX_LARGE_UPLOAD_BYTES, MAX_UPLOAD_BYTES, UploadError, deleteFile, fileResponse, getFile, largeUploadRoom, largeUploadsEnabled, saveLargeUpload, saveUpload, saveUploadFrom, uploadProblem } from "@/server/files";
import { testDb } from "./db";

describe("files", () => {
  it("keeps an uploaded photo and gives it back byte for byte", async () => {
    const db = await testDb();
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const id = await saveUpload(new File([bytes], "scan.png", { type: "image/png" }), "u1", db, 1);
    const f = await getFile(id, db);
    expect(f).toMatchObject({ name: "scan.png", type: "image/png", size: 7, uploadedBy: "u1" });
    expect([...new Uint8Array(f!.data)]).toEqual([...bytes]);
    const res = fileResponse(f!);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="scan.png"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    await deleteFile(id, db);
    expect(await getFile(id, db)).toBeUndefined();
  });

  it("refuses files that are empty, too big, or could run scripts, in plain words", async () => {
    const db = await testDb();
    expect(uploadProblem(null)).toMatch(/Choose a file/);
    expect(uploadProblem({ size: MAX_UPLOAD_BYTES + 1, type: "image/png" })).toMatch(/too big/);
    expect(uploadProblem({ size: 10, type: "text/html" })).toMatch(/cannot be kept/);
    expect(uploadProblem({ size: 10, type: "image/svg+xml" })).toMatch(/cannot be kept/);
    await expect(saveUpload(new File(["<script>"], "x.html", { type: "text/html" }), null, db)).rejects.toBeInstanceOf(UploadError);
  });

  it("documents download instead of opening, and odd characters cannot break the file name", async () => {
    const db = await testDb();
    const id = await saveUpload(new File(["a,b\n1,2\n"], 'fees"\r\n.csv', { type: "text/csv" }), null, db);
    const f = (await getFile(id, db))!;
    expect(f.name).toBe("fees___.csv");
    expect(fileResponse(f).headers.get("content-disposition")).toBe('attachment; filename="fees___.csv"');
  });
});

describe("large files", () => {
  const blobUrl = "https://abc123.public.blob.vercel-storage.com/lesson-video-Xk3j9QpL2mN8vB4cR7tY1wZ5.mp4";
  const lookup = (info: { size: number; contentType: string }) => async (url: string) => ({ ...info, pathname: new URL(url).pathname.slice(1) });

  it("are allowed only with a file-storage account", () => {
    expect(largeUploadsEnabled({})).toBe(false);
    expect(largeUploadsEnabled({ BLOB_READ_WRITE_TOKEN: "not-a-real-token" })).toBe(true);
  });

  it("keeps a record of a video the browser sent to file storage, and sends people to it", async () => {
    const db = await testDb();
    const form = new FormData();
    form.set("fileUrl", blobUrl);
    const id = await saveUploadFrom(form, "u1", db, lookup({ size: 80 * 1024 * 1024, contentType: "video/mp4" }));
    const f = (await getFile(id, db))!;
    expect(f).toMatchObject({ name: "lesson-video.mp4", type: "video/mp4", size: 80 * 1024 * 1024, url: blobUrl, uploadedBy: "u1" });
    const res = fileResponse(f);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(blobUrl);
  });

  it("refuses addresses that are not this app's file storage, and files too big or of the wrong kind", async () => {
    const db = await testDb();
    const ok = lookup({ size: 10, contentType: "video/mp4" });
    await expect(saveLargeUpload("https://evil.example.com/x.mp4", null, db, ok)).rejects.toThrow(/did not arrive/);
    const missing = async () => {
      throw new Error("BlobNotFoundError");
    };
    await expect(saveLargeUpload(blobUrl, null, db, missing)).rejects.toThrow(/did not arrive/);
    await expect(saveLargeUpload(blobUrl, null, db, lookup({ size: MAX_LARGE_UPLOAD_BYTES + 1, contentType: "video/mp4" }))).rejects.toThrow(/too big/);
    await expect(saveLargeUpload(blobUrl, null, db, lookup({ size: 10, contentType: "text/html" }))).rejects.toBeInstanceOf(UploadError);
  });

  it("takes a refused file out of storage again, and a deleted one too, but never one already kept", async () => {
    const db = await testDb();
    const removed: string[] = [];
    const remove = async (url: string) => void removed.push(url);
    const video = lookup({ size: 10, contentType: "video/mp4" });
    await expect(saveLargeUpload(blobUrl, null, db, lookup({ size: 10, contentType: "text/html" }), Date.now(), remove)).rejects.toBeInstanceOf(UploadError);
    expect(removed).toEqual([blobUrl]);
    const id = await saveLargeUpload(blobUrl, "u1", db, video, Date.now(), remove);
    // the same address cannot be kept twice, and refusing it leaves the kept file alone
    await expect(saveLargeUpload(blobUrl, "u2", db, lookup({ size: 10, contentType: "text/html" }), Date.now(), remove)).rejects.toThrow(/did not arrive/);
    expect(removed).toHaveLength(1);
    await deleteFile(id, db, remove);
    expect(removed).toEqual([blobUrl, blobUrl]);
    expect(await getFile(id, db)).toBeUndefined();
    // a file kept in the database has nothing in storage to remove
    const small = await saveUpload(new File(["hello"], "note.txt", { type: "text/plain" }), null, db);
    await deleteFile(small, db, remove);
    expect(removed).toHaveLength(2);
  });

  it("stops one person filling file storage in a day", async () => {
    const db = await testDb();
    const removed: string[] = [];
    const remove = async (url: string) => void removed.push(url);
    const big = lookup({ size: MAX_LARGE_UPLOAD_BYTES, contentType: "video/mp4" });
    const at = (n: number) => `https://abc123.public.blob.vercel-storage.com/v${n}.mp4`;
    const now = 1_800_000_000_000;
    const fits = Math.floor(MAX_LARGE_DAILY_BYTES / MAX_LARGE_UPLOAD_BYTES);
    for (let n = 0; n < fits; n++) await saveLargeUpload(at(n), "u1", db, big, now, remove);
    expect(await largeUploadRoom("u1", db, now)).toBeLessThan(MAX_LARGE_UPLOAD_BYTES);
    await expect(saveLargeUpload(at(99), "u1", db, big, now, remove)).rejects.toThrow(/try again tomorrow/);
    expect(removed).toEqual([at(99)]);
    // someone else is not affected, and the limit lifts a day later
    expect(await largeUploadRoom("u2", db, now)).toBe(MAX_LARGE_DAILY_BYTES);
    await saveLargeUpload(at(100), "u1", db, big, now + 25 * 60 * 60 * 1000, remove);
  });

  it("a small file still goes with the form, and video is never kept in the database", async () => {
    const db = await testDb();
    const form = new FormData();
    form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    form.set("fileUrl", "");
    const id = await saveUploadFrom(form, null, db);
    expect((await getFile(id, db))!.url).toBeNull();
    expect(uploadProblem({ size: 10, type: "video/mp4" })).toMatch(/cannot be kept/);
  });
});
