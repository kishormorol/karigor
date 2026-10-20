import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { MockAdapter, ModelAgent, OllamaAdapter, safePath, workspaceContext } from "../src/index.js";

const Out = z.object({ title: z.string(), n: z.number() });
const req = { tier: "judgment" as const, system: "sys", user: "do it", schema: Out, key: "k", role: "planner" as const };

function fakeFetch(answer: (body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const seen: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    seen.push(body);
    const a = answer(body);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe("OllamaAdapter", () => {
  it("asks for the role's JSON schema and validates the answer; local models cost nothing", async () => {
    const { f, seen } = fakeFetch(() => ({ json: { model: "qwen2.5:7b", message: { content: '{"title":"t","n":2}' }, done_reason: "stop", prompt_eval_count: 120, eval_count: 9 } }));
    const a = new OllamaAdapter({ fetchImpl: f, judgmentModel: "qwen2.5:7b", host: "localhost:11434" });
    const r = await a.complete(req);
    expect(r).toMatchObject({ ok: true, output: { title: "t", n: 2 }, model: "ollama/qwen2.5:7b", usage: { inputTokens: 120, outputTokens: 9 } });
    expect(seen[0]).toMatchObject({ model: "qwen2.5:7b", stream: false, options: { temperature: 0 } });
    expect((seen[0]!["format"] as { properties: object }).properties).toHaveProperty("title");
    expect(a.modelFor("routine")).toBe("ollama/qwen2.5:7b");
  });

  it("reports schema mismatches as invalid, a missing model plainly, and an unreachable server", async () => {
    const bad = new OllamaAdapter({ fetchImpl: fakeFetch(() => ({ json: { message: { content: '{"title":3}' } } })).f });
    expect(await bad.complete(req)).toMatchObject({ ok: false, error: "invalid", retryable: true });
    const missing = new OllamaAdapter({ fetchImpl: fakeFetch(() => ({ status: 404, json: { error: 'model "x" not found, try pulling it first' } })).f, judgmentModel: "x" });
    expect(await missing.complete(req)).toMatchObject({ ok: false, error: "api", message: expect.stringMatching(/ollama pull x/) });
    const down = new OllamaAdapter({ fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch });
    expect(await down.complete(req)).toMatchObject({ ok: false, error: "api", message: expect.stringMatching(/ollama serve/) });
  });
});

describe("ModelAgent", () => {
  it("shows the model the workspace, applies whole-file writes and deletes, and refuses paths outside it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karigor-ma-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "node_modules/x"), { recursive: true });
    await writeFile(join(dir, "src/old.js"), "export const old = 1;\n");
    await writeFile(join(dir, "node_modules/x/index.js"), "SECRET_NOT_SHOWN");
    let seenUser = "";
    const model = new MockAdapter((r) => {
      seenUser = r.user;
      return {
        summary: "Added the list.",
        files: [
          { path: "src/list.js", action: "write", content: "export const list = [];\n" },
          { path: "src/old.js", action: "delete", content: "" },
          { path: "../escape.js", action: "write", content: "x" },
          { path: "node_modules/evil.js", action: "write", content: "x" },
        ],
      };
    });
    const agent = new ModelAgent(model);
    const res = await agent.act({ tier: "mock", system: "s", user: "build b1", cwd: dir, key: "k", role: "developer" });
    expect(res.ok).toBe(true);
    expect(seenUser).toMatch(/export const old = 1/);
    expect(seenUser).not.toMatch(/SECRET_NOT_SHOWN/);
    expect(await readFile(join(dir, "src/list.js"), "utf8")).toBe("export const list = [];\n");
    await expect(readFile(join(dir, "src/old.js"))).rejects.toThrow();
    await expect(readFile(join(dir, "..", "escape.js"))).rejects.toThrow();
    expect(res.ok && res.summary).toMatch(/refused paths outside the workspace: \.\.\/escape\.js, node_modules\/evil\.js/);
  });

  it("guards paths and caps context", async () => {
    expect(safePath("/w", "src/a.ts")).toBe("/w/src/a.ts");
    for (const p of ["../a", "/etc/passwd/../../a/../../..", ".git/config", "pnpm-lock.yaml", "a/node_modules/b", ""]) expect(safePath("/w", p), p).toBeUndefined();
    const dir = await mkdtemp(join(tmpdir(), "karigor-ma-"));
    await writeFile(join(dir, "big.ts"), "x".repeat(5000));
    expect(await workspaceContext(dir, 1000, 4000)).toMatch(/not shown: 5000 bytes/);
  });
});

/** Needs a running Ollama with the model pulled. Run with KARIGOR_REAL_MODEL=1 (and KARIGOR_OLLAMA_MODEL to pick one). */
describe.runIf(process.env["KARIGOR_REAL_MODEL"] === "1" && process.env["KARIGOR_SKIP_OLLAMA"] !== "1")("OllamaAdapter (live)", () => {
  it("returns schema-valid structured output from a local model", async () => {
    const a = new OllamaAdapter();
    const r = await a.complete({
      tier: "routine",
      system: "You turn a one-line idea into a title and exactly three goals. Answer only in the requested JSON.",
      user: "Idea: a site where neighbours lend tools to each other.",
      schema: z.object({ title: z.string().min(1), goals: z.array(z.string().min(1)).length(3) }),
      key: "live",
      role: "product-owner",
    });
    expect(r.ok, r.ok ? "" : r.message).toBe(true);
    if (r.ok) expect(r.model).toMatch(/^ollama\//);
  }, 300_000);
});
