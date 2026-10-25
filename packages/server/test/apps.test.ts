import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AppPorts, createKarigorServer, LiveApps, type KarigorServer } from "../src/index.js";

const SERVE = `import { createServer } from "node:http";
createServer((req, res) => res.end(req.url === "/health" ? "ok" : JSON.stringify({ release: process.env.RELEASE_NAME, site: process.env.SITE_URL }))).listen(Number(process.env.PORT), "127.0.0.1");
`;

/** A project with `version` live, as a local release leaves it. */
async function release(root: string, id: string, version: string) {
  const dir = join(root, id, "releases", version);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "serve.mjs"), SERVE.replace("process.env.RELEASE_NAME", JSON.stringify(version)));
  await writeFile(join(root, id, "releases", "current.json"), JSON.stringify({ version, history: [] }));
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
});

describe("hosted apps", { timeout: 60_000 }, () => {
  it("gives each project its own port, once", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-apps-"));
    const ports = new AppPorts(root, 4100);
    const [a, b, a2] = await Promise.all([ports.portFor("p-a"), ports.portFor("p-b"), ports.portFor("p-a")]);
    expect([a, b, a2]).toEqual([4100, 4101, 4100]);
    expect(await new AppPorts(root, 4100).all()).toEqual({ "p-a": 4100, "p-b": 4101 });
  });

  it("keeps each live release running on its port and switches to a new one", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-apps-"));
    const ports = new AppPorts(root, 4200 + Math.floor(Math.random() * 500));
    const port = await ports.portFor("p-a");
    await ports.portFor("p-quiet"); // nothing live yet: nothing to run
    const live = new LiveApps({ root, profile: "fixture", ports, publicUrl: "https://a{port}.example.com" });
    stops.push(() => live.stop());

    await release(root, "p-a", "v1");
    await live.check();
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).json()).toEqual({ release: "v1", site: `https://a${port}.example.com` });

    await release(root, "p-a", "v2");
    await live.check();
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).json()).toMatchObject({ release: "v2" });
  });

  it("shows hosted apps at their public address and vouches only for those addresses", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-apps-"));
    const k: KarigorServer = createKarigorServer({ root, adapter: "demo", profile: "fixture", apps: { url: "https://a{port}.example.com" } });
    stops.push(async () => {
      await k.idle();
      await new Promise((r) => k.server.close(r));
    });
    await new Promise<void>((r) => k.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(k.server.address() as AddressInfo).port}`;
    const port = await new AppPorts(root).portFor("p-a");
    expect((await fetch(`${base}/tls-ok?domain=a${port}.example.com`)).status).toBe(200);
    expect((await fetch(`${base}/tls-ok?domain=a9999.example.com`)).status).toBe(404);
    expect((await fetch(`${base}/tls-ok?domain=evil.com`)).status).toBe(404);
  });
});
