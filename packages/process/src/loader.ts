import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { TemplateSchema, type Template } from "./template-schema.js";

export class TemplateError extends Error {
  override name = "TemplateError";
}

const here = dirname(fileURLToPath(import.meta.url));
/** Works from both `src/` (tests) and `dist/` (build). */
export const TEMPLATES_DIR = join(here, "..", "templates");

/** Parse and validate a template from YAML text. Throws `TemplateError` naming the first problem. */
export function parseTemplate(text: string, source = "<inline>"): Template {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new TemplateError(`${source}: not valid YAML: ${(e as Error).message}`);
  }
  const r = TemplateSchema.safeParse(raw);
  if (!r.success) throw new TemplateError(`${source}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const t = r.data;
  validateTemplate(t, source);
  return t;
}

/** Structural checks the schema cannot express. */
export function validateTemplate(t: Template, source = t.name): void {
  const names = Object.keys(t.phases);
  const fail = (msg: string): never => {
    throw new TemplateError(`${source}: ${msg}`);
  };
  if (!t.phases[t.initialPhase]) fail(`initialPhase "${t.initialPhase}" is not a phase`);

  for (const [name, phase] of Object.entries(t.phases)) {
    for (const tr of phase.transitions) {
      if (!t.phases[tr.to]) fail(`phase "${name}" transitions to unknown phase "${tr.to}"`);
      for (const rung of tr.onFail) {
        if (rung.action === "park" || rung.action === "shrink") fail(`phase "${name}" -> "${tr.to}": "${rung.action}" is an item action, not a phase action`);
        if (rung.action === "sendBack" && !t.phases[rung.phase]) fail(`phase "${name}" sends back to unknown phase "${rung.phase}"`);
      }
      const last = tr.onFail[tr.onFail.length - 1]!;
      if (last.action !== "stop" && last.action !== "sendBack") fail(`phase "${name}" -> "${tr.to}": last onFail rung must be stop or sendBack`);
    }
    if (phase.loop) {
      for (const rung of phase.loop.onItemFail) {
        if (rung.action === "stop" || rung.action === "sendBack") fail(`phase "${name}": "${rung.action}" is a phase action, not an item action`);
      }
      const last = phase.loop.onItemFail[phase.loop.onItemFail.length - 1]!;
      if (last.action !== "park") fail(`phase "${name}": last onItemFail rung must be park`);
    }
    if (phase.terminal && phase.transitions.length > 0) fail(`terminal phase "${name}" must not have transitions`);
    if (!phase.terminal && phase.transitions.length === 0) fail(`phase "${name}" has no transitions and is not terminal`);
  }

  // Every phase reachable from the initial phase, and a terminal phase reachable.
  const seen = new Set<string>();
  const stack = [t.initialPhase];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const tr of t.phases[n]!.transitions) stack.push(tr.to);
  }
  const unreachable = names.filter((n) => !seen.has(n));
  if (unreachable.length) fail(`unreachable phases: ${unreachable.join(", ")}`);
  if (![...seen].some((n) => t.phases[n]!.terminal)) fail("no terminal phase is reachable");
}

export async function loadTemplate(name: string, dir = TEMPLATES_DIR): Promise<Template> {
  const file = join(dir, `${name}.yaml`);
  const text = await readFile(file, "utf8").catch(() => {
    throw new TemplateError(`no template "${name}" in ${dir}`);
  });
  const t = parseTemplate(text, file);
  if (t.name !== name) throw new TemplateError(`${file}: template name "${t.name}" does not match file name`);
  return t;
}

export async function listTemplates(dir = TEMPLATES_DIR): Promise<string[]> {
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith(".yaml")).map((n) => n.slice(0, -5)).sort();
}
