import { toJsonSchema } from "./claude-code.js";
import type { ModelAdapter, ModelRequest, ModelResponse, Usage } from "./types.js";

export interface OllamaAdapterOptions {
  /** Defaults to `OLLAMA_HOST`, then the local default. */
  host?: string;
  /** Model for decisions and reviews. Defaults to `KARIGOR_OLLAMA_MODEL`, then `qwen2.5:7b`. */
  judgmentModel?: string;
  /** Model for routine work. Defaults to the judgment model. */
  routineModel?: string;
  /** Context window to ask for; role prompts with inputs are long. */
  numCtx?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const OLLAMA_DEFAULTS = {
  host: "http://127.0.0.1:11434",
  model: "qwen2.5:7b",
  numCtx: 32_768,
  timeoutMs: 30 * 60 * 1000,
} as const;

interface ChatResponse {
  model?: string;
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * A local model through Ollama: free, offline, no account. Structured output uses Ollama's
 * `format` with the role's JSON schema. Model ids are `ollama/<model>`, which the budget treats
 * as costing nothing.
 */
export class OllamaAdapter implements ModelAdapter {
  readonly name = "ollama";
  private readonly host: string;
  private readonly judgmentModel: string;
  private readonly routineModel: string;
  private readonly f: typeof fetch;

  constructor(private readonly o: OllamaAdapterOptions = {}) {
    this.host = (o.host ?? process.env["OLLAMA_HOST"] ?? OLLAMA_DEFAULTS.host).replace(/\/+$/, "");
    if (!/^https?:\/\//.test(this.host)) this.host = `http://${this.host}`;
    this.judgmentModel = o.judgmentModel ?? process.env["KARIGOR_OLLAMA_MODEL"] ?? OLLAMA_DEFAULTS.model;
    this.routineModel = o.routineModel ?? process.env["KARIGOR_OLLAMA_ROUTINE_MODEL"] ?? this.judgmentModel;
    this.f = o.fetchImpl ?? fetch;
  }

  modelFor(tier: ModelRequest<unknown>["tier"]): string {
    return `ollama/${tier === "routine" ? this.routineModel : this.judgmentModel}`;
  }

  async complete<T>(req: ModelRequest<T>): Promise<ModelResponse<T>> {
    const model = req.tier === "routine" ? this.routineModel : this.judgmentModel;
    const id = `ollama/${model}`;
    const zero: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const schema = toJsonSchema(req.schema);
    let res: Response;
    try {
      res = await this.f(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: schema,
          options: { temperature: 0, num_ctx: this.o.numCtx ?? OLLAMA_DEFAULTS.numCtx },
          messages: [
            { role: "system", content: `${req.system}\n\nAnswer with one JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}` },
            { role: "user", content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? OLLAMA_DEFAULTS.timeoutMs),
      });
    } catch (e) {
      const msg = (e as Error).message;
      return { ok: false, error: "api", message: `could not reach Ollama at ${this.host}: ${msg}. Is it running (ollama serve)?`, retryable: /timeout|abort/i.test(msg), usage: zero, model: id };
    }
    let body: ChatResponse;
    try {
      body = (await res.json()) as ChatResponse;
    } catch {
      return { ok: false, error: "api", message: `Ollama answered ${res.status} without JSON`, retryable: res.status >= 500, usage: zero, model: id };
    }
    if (!res.ok || body.error) {
      const msg = body.error ?? `HTTP ${res.status}`;
      const missing = /not found|pull/i.test(msg);
      return { ok: false, error: "api", message: missing ? `the model ${model} is not installed: run "ollama pull ${model}"` : `Ollama: ${msg}`, retryable: res.status >= 500 && !missing, usage: zero, model: id };
    }
    const usage: Usage = { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const text = body.message?.content ?? "";
    if (body.done_reason === "length") return { ok: false, error: "invalid", message: "output was cut off at the context limit", retryable: true, usage, model: id, raw: text.slice(0, 4000) };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, error: "invalid", message: "the answer was not JSON", retryable: true, usage, model: id, raw: text.slice(0, 4000) };
    }
    const r = req.schema.safeParse(raw);
    if (!r.success) return { ok: false, error: "invalid", message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), retryable: true, usage, model: id, raw: text.slice(0, 4000) };
    return { ok: true, output: r.data, usage, model: id };
  }
}
