import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, sep } from "node:path";
import { z } from "zod/v4";
import type { ModelTier } from "@karigor/store";
import type { ModelAdapter } from "../adapters/types.js";
import type { AgentAdapter, AgentRequest, AgentResponse } from "./types.js";

export const ModelAgentOutput = z.object({
  summary: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        action: z.enum(["write", "delete"]),
        /** The whole new file. Empty for a delete. */
        content: z.string(),
      }),
    )
    .min(1),
});
export type ModelAgentOutput = z.infer<typeof ModelAgentOutput>;

export interface ModelAgentOptions {
  /** Characters of existing source shown to the model. */
  maxContextChars?: number;
  /** Largest single file shown. */
  maxFileChars?: number;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".vercel", "data"]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|yaml|yml|toml|txt|sql|env\.example)$|^\.env\.example$|\.gitignore$/;
const SKIP_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);

const INSTRUCTIONS = `
## How you work here

You cannot run commands. You see the workspace's files below and answer with JSON: every file you create or change, written out in full (not a diff), and every file you delete. Karigor writes them into the workspace and then runs the tests, lint and build itself, and shows you any failures on the next round.

- Paths are relative to the workspace root, with forward slashes.
- Never write inside .git or node_modules, and never touch lock files.
- Include the tests for the item in the same answer.
- \`summary\`: two or three plain sentences a non-technical person could read.
`;

/**
 * Any model adapter as a developer: it reads the workspace, answers with whole-file writes, and
 * those are applied inside the workspace. This is how the API and local models build real code.
 */
export class ModelAgent implements AgentAdapter {
  readonly name: string;
  constructor(
    private readonly model: ModelAdapter,
    private readonly o: ModelAgentOptions = {},
  ) {
    this.name = `model:${model.name}`;
  }

  modelFor(tier: ModelTier): string {
    return this.model.modelFor(tier);
  }

  async act(req: AgentRequest): Promise<AgentResponse> {
    const context = await workspaceContext(req.cwd, this.o.maxContextChars ?? 120_000, this.o.maxFileChars ?? 30_000);
    const res = await this.model.complete({
      tier: req.tier,
      system: `${req.system}\n${INSTRUCTIONS}`,
      user: `${req.user}\n\n## The workspace now\n\n${context}`,
      schema: ModelAgentOutput,
      key: req.key,
      role: req.role,
      maxTokens: 32_000,
    });
    if (!res.ok) {
      const error = res.error === "invalid" ? "api" : res.error;
      return { ok: false, error, message: res.error === "invalid" ? `the answer could not be used: ${res.message}` : res.message, retryable: res.retryable, usage: res.usage, model: res.model, ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}) };
    }
    const applied: string[] = [];
    const refused: string[] = [];
    for (const f of res.output.files) {
      const target = safePath(req.cwd, f.path);
      if (!target) {
        refused.push(f.path);
        continue;
      }
      if (f.action === "delete") await rm(target, { force: true });
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, f.content, "utf8");
      }
      applied.push(`${f.action} ${f.path}`);
    }
    const summary = refused.length ? `${res.output.summary}\n\n(refused paths outside the workspace: ${refused.join(", ")})` : res.output.summary;
    return { ok: true, summary, usage: res.usage, model: res.model, turns: 1, ...(res.costUsd !== undefined ? { costUsd: res.costUsd } : {}) };
  }
}

/** The absolute path for a workspace-relative one, or undefined when it escapes or hits a protected place. */
export function safePath(root: string, path: string): string | undefined {
  if (path.includes("\0")) return undefined;
  const abs = normalize(join(root, path));
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || rel.split(sep).some((p) => p === ".git" || p === "node_modules")) return undefined;
  if (SKIP_FILES.has(rel)) return undefined;
  return abs;
}

/** A file listing plus the contents of the source files that fit, smallest-first within each folder. */
export async function workspaceContext(root: string, maxChars: number, maxFileChars: number): Promise<string> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name));
      } else if (e.isFile()) files.push(relative(root, join(dir, e.name)));
    }
  };
  await walk(root);
  files.sort();
  const parts = ["Files:", ...files.map((f) => `- ${f}`), ""];
  let used = parts.join("\n").length;
  for (const f of files) {
    const name = f.split(sep).at(-1) ?? f;
    if (!TEXT.test(name) || SKIP_FILES.has(name)) continue;
    const size = (await stat(join(root, f))).size;
    if (size > maxFileChars || used + size > maxChars) {
      parts.push(`### ${f}\n\n(not shown: ${size} bytes)\n`);
      continue;
    }
    const text = await readFile(join(root, f), "utf8");
    parts.push(`### ${f}\n\n\`\`\`\n${text}\n\`\`\`\n`);
    used += text.length + f.length + 20;
  }
  return parts.join("\n");
}
