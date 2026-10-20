import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createKarigorServer, type KarigorServer } from "../src/index.js";

const open: KarigorServer[] = [];
afterEach(async () => {
  for (const k of open.splice(0)) {
    await k.idle();
    await new Promise((r) => k.server.close(r));
  }
});

async function start(o: { token?: string; adapter?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "karigor-server-"));
  const k = createKarigorServer({ root, adapter: o.adapter ?? "demo", ...(o.token ? { token: o.token } : {}) });
  open.push(k);
  await new Promise<void>((r) => k.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(k.server.address() as AddressInfo).port}`;
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown>, res };
  };
  return { k, base, call, root };
}

describe("server", { timeout: 180_000 }, () => {
  it("serves the chat page with a strict content policy", async () => {
    const { base } = await start();
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
    const html = await res.text();
    expect(html).toMatch(/<title>Karigor<\/title>/);
    expect(html).toMatch(/Tell me your idea/);
  });

  it("an idea becomes a project that is built in the background and reads in plain language", async () => {
    const { k, call } = await start();
    expect((await call("/api/config")).json).toMatchObject({ demo: true, needsKey: false });
    const created = await call("/api/projects", { method: "POST", body: JSON.stringify({ idea: "A site where neighbours lend tools" }) });
    expect(created.status).toBe(201);
    const id = created.json["projectId"] as string;
    expect(k.runs.has(id)).toBe(true);
    await k.idle();
    const v = (await call(`/api/projects/${id}`)).json;
    expect(v).toMatchObject({ id, status: "finished", running: false, idea: "A site where neighbours lend tools", work: { done: 3, open: 0 } });
    expect(v["summary"]).toMatchObject({ headline: "ToolShare is live" });
    expect((v["decisions"] as { id: string }[]).map((d) => d.id)).toEqual(["a1", "a2", "a3", "a4"]);
    expect((v["story"] as string[]).join("\n")).toMatch(/Chose the "iterative" process/);
    const list = (await call("/api/projects")).json["projects"] as { id: string; status: string }[];
    expect(list).toEqual([expect.objectContaining({ id, status: "finished", running: false })]);
  });

  it("feedback and corrections on a finished project start a fix round on their own", async () => {
    const { k, call } = await start();
    const id = (await call("/api/projects", { method: "POST", body: JSON.stringify({ idea: "Tool lending" }) })).json["projectId"] as string;
    await k.idle();
    const fb = await call(`/api/projects/${id}/feedback`, { method: "POST", body: JSON.stringify({ text: "Please show who has my drill" }) });
    expect(fb.status).toBe(202);
    expect(fb.json).toMatchObject({ fixing: true });
    await k.idle();
    let v = (await call(`/api/projects/${id}`)).json;
    expect(v).toMatchObject({ status: "finished", cycle: 1 });
    expect(v["workItems"]).toEqual([expect.objectContaining({ title: "Please show who has my drill", status: "done", source: "feedback" })]);
    const fix = await call(`/api/projects/${id}/corrections`, { method: "POST", body: JSON.stringify({ decisionId: "a3", text: "English and Bangla" }) });
    expect(fix.json).toMatchObject({ fixing: true });
    await k.idle();
    v = (await call(`/api/projects/${id}`)).json;
    expect(v).toMatchObject({ cycle: 2 });
    expect((v["decisions"] as { id: string; correctedTo?: string }[]).find((d) => d.id === "a3")?.correctedTo).toBe("English and Bangla");
    expect((await call(`/api/projects/${id}/corrections`, { method: "POST", body: JSON.stringify({ decisionId: "a99", text: "x" }) })).status).toBe(400);
  });

  it("streams the project as it changes", async () => {
    const { k, call, base } = await start();
    const id = (await call("/api/projects", { method: "POST", body: JSON.stringify({ idea: "Tool lending" }) })).json["projectId"] as string;
    const ac = new AbortController();
    const res = await fetch(`${base}/api/projects/${id}/stream`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const seen: { status: string; running: boolean }[] = [];
    let buf = "";
    while (!seen.some((s) => s.status === "finished" && !s.running)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      for (const chunk of buf.split("\n\n").slice(0, -1)) if (chunk.startsWith("data: ")) seen.push(JSON.parse(chunk.slice(6)));
      buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
    }
    ac.abort();
    await k.idle();
    expect(seen[0]?.status).not.toBe("finished");
    expect(seen.at(-1)).toMatchObject({ status: "finished", running: false });
  });

  it("refuses settings while there is nowhere to store them, and rejects bad shapes", async () => {
    const { k, call } = await start();
    const id = (await call("/api/projects", { method: "POST", body: JSON.stringify({ idea: "Tool lending" }) })).json["projectId"] as string;
    await k.idle();
    expect((await call(`/api/projects/${id}/settings`, { method: "POST", body: JSON.stringify({ values: "x" }) })).status).toBe(400);
    const r = await call(`/api/projects/${id}/settings`, { method: "POST", body: JSON.stringify({ values: { FAMILY_PASSCODE: "x" } }) });
    expect(r.status).toBe(400);
    expect(r.json["error"]).toMatch(/does not put apps online/);
  });

  it("guards the API with a token, sets it as a cookie from an access link, and rejects bad input", async () => {
    const { call, base } = await start({ token: "s3cret-token" });
    expect((await call("/api/projects")).status).toBe(401);
    expect((await call("/api/projects", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await call("/api/projects", { headers: { authorization: "Bearer s3cret-token" } })).status).toBe(200);
    const link = await fetch(`${base}/?token=s3cret-token`, { redirect: "manual" });
    expect(link.status).toBe(302);
    const setCookie = link.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly; SameSite=Strict/);
    const cookie = setCookie.split(";")[0]!;
    expect((await call("/api/projects", { headers: { cookie } })).status).toBe(200);
    const auth = { authorization: "Bearer s3cret-token" };
    expect((await call("/api/projects", { method: "POST", headers: auth, body: "not json" })).status).toBe(400);
    expect((await call("/api/projects", { method: "POST", headers: auth, body: JSON.stringify({ idea: "" }) })).json).toMatchObject({ error: "idea is missing" });
    expect((await call("/api/projects/..%2F..%2Fetc", { headers: auth })).status).toBe(404);
    expect((await call("/api/projects", { method: "POST", headers: auth, body: JSON.stringify({ idea: "x".repeat(70_000) }) })).status).toBe(413);
  });

  it("asks for the person's own key when it runs on the API without one", async () => {
    const prev = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      const { call } = await start({ adapter: "claude" });
      expect((await call("/api/config")).json).toMatchObject({ needsKey: true });
      expect((await call("/api/projects", { method: "POST", body: JSON.stringify({ idea: "x" }) })).json).toMatchObject({ error: expect.stringMatching(/your own Anthropic key/) });
    } finally {
      if (prev !== undefined) process.env["ANTHROPIC_API_KEY"] = prev;
    }
  });
});
