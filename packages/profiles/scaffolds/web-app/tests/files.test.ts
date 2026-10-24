import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, UploadError, deleteFile, fileResponse, getFile, saveUpload, uploadProblem } from "@/server/files";
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
