import type { CommandResult, UrlCheck } from "@karigor/gates";
import type { DeployAdapter, DeployRequest, DeployResult, LiveRelease } from "./types.js";

export type FakeDeployScript = Partial<{
  preview: (r: DeployRequest) => Partial<DeployResult>;
  promote: (r: DeployRequest) => Partial<DeployResult>;
  rollback: Partial<CommandResult>;
  verifyRollback: (live?: LiveRelease) => Partial<CommandResult>;
  url: (url: string) => Partial<UrlCheck>;
}>;

/** Scripted target for tests and the demo. Everything works unless the script says otherwise. */
export class FakeDeploy implements DeployAdapter {
  readonly name = "fake";
  readonly calls: string[] = [];
  constructor(private readonly script: FakeDeployScript = {}, private readonly base = "https://demo.karigor.invalid") {}

  describe(): string {
    return "a pretend hosting target used for demonstrations; nothing is really online";
  }

  async preview(r: DeployRequest): Promise<DeployResult> {
    this.calls.push(`preview:${r.version}`);
    return { ok: true, url: `${this.base}/preview/${r.version}`, id: `preview-${r.version}`, output: `preview of ${r.version} is up`, ...this.script.preview?.(r) };
  }

  async promote(r: DeployRequest & { preview: DeployResult }): Promise<DeployResult> {
    this.calls.push(`promote:${r.version}`);
    return { ok: true, url: this.base, id: `prod-${r.version}`, output: `${r.version} is live`, ...this.script.promote?.(r) };
  }

  async rollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    this.calls.push(`rollback:${r.live?.version ?? "offline"}`);
    return { ok: true, output: r.live ? `back to ${r.live.version}` : "taken offline", ...this.script.rollback };
  }

  async verifyRollback(r: { dir: string; live?: LiveRelease }): Promise<CommandResult> {
    this.calls.push(`verifyRollback:${r.live?.version ?? "none"}`);
    return { ok: true, output: r.live ? `${r.live.version} would come back` : "first release: rolling back means taking it offline", ...this.script.verifyRollback?.(r.live) };
  }

  async checkUrl(url: string): Promise<UrlCheck> {
    this.calls.push(`checkUrl:${url}`);
    return { ok: true, status: 200, output: "200 OK", ...this.script.url?.(url) };
  }

  async stop(): Promise<void> {
    this.calls.push("stop");
  }
}
