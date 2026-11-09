import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { balanceOf, createKarigorServer, PaddleProvider, People, SslCommerzProvider, type KarigorServer } from "../src/index.js";

const NOW = 1_794_000_000_000;
const SECRET = "test-webhook-secret";

function paddleNotice(body: unknown, o: { ts?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = o.ts ?? NOW / 1000;
  const h1 = createHmac("sha256", o.secret ?? SECRET).update(`${ts}:${raw}`).digest("hex");
  return { raw, headers: { "paddle-signature": `ts=${ts};h1=${h1}` } };
}
const completed = (personId = "p1", subtotal = "1000") => ({ event_type: "transaction.completed", data: { id: "txn_1", status: "completed", custom_data: { personId }, details: { totals: { subtotal, currency_code: "USD" } } } });

describe("Paddle", () => {
  const paddle = (fetchImpl?: typeof fetch) => new PaddleProvider({ apiKey: "test-paddle-key", productId: "pro_1", webhookSecret: SECRET, sandbox: true, now: () => NOW, ...(fetchImpl ? { fetchImpl } : {}) });

  it("counts a signed, completed transaction at Paddle's own subtotal, and nothing else", async () => {
    expect(await paddle().confirm(paddleNotice(completed("p1", "1000")))).toEqual({ ref: "paddle:txn_1", personId: "p1", usd: 10 });
    expect(await paddle().confirm(paddleNotice(completed(), { secret: "not-the-secret" }))).toBeUndefined();
    expect(await paddle().confirm(paddleNotice(completed(), { ts: NOW / 1000 - 3600 }))).toBeUndefined();
    expect(await paddle().confirm(paddleNotice({ ...completed(), event_type: "transaction.created" }))).toBeUndefined();
    const forged = paddleNotice(completed());
    expect(await paddle().confirm({ ...forged, raw: forged.raw.replace('"1000"', '"100000"') })).toBeUndefined();
  });

  it("opens a checkout for the amount, carrying who it is for", async () => {
    const seen: { url: string; body: string; auth: string | null }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: String(init.body), auth: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ data: { checkout: { url: "https://pay.example/checkout/1" } } }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await paddle(f).checkout({ personId: "p1", name: "Rina", usd: 5, returnUrl: "/" })).toEqual({ url: "https://pay.example/checkout/1" });
    expect(seen[0]!.url).toBe("https://sandbox-api.paddle.com/transactions");
    expect(seen[0]!.auth).toBe("Bearer test-paddle-key");
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ custom_data: { personId: "p1", usd: 5 }, items: [{ price: { unit_price: { amount: "500", currency_code: "USD" } } }] });
  });
});

describe("SSLCommerz", () => {
  function ssl(validation: Record<string, string>) {
    const seen: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${url} ${init?.body ? String(init.body) : ""}`);
      if (url.includes("/gwprocess/")) return new Response(JSON.stringify({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/pay/1" }));
      return new Response(JSON.stringify(validation));
    }) as unknown as typeof fetch;
    return { p: new SslCommerzProvider({ storeId: "test-store", storePassword: "test-store-pass", bdtPerUsd: 120, publicUrl: "https://karigor.example.com/", sandbox: true, fetchImpl: f }), seen };
  }

  it("asks for the price in taka and sends notices back to Karigor", async () => {
    const { p, seen } = ssl({});
    expect(await p.checkout({ personId: "p1", name: "Rina", usd: 5 })).toEqual({ url: "https://sandbox.sslcommerz.com/pay/1" });
    const form = new URLSearchParams(seen[0]!.split(" ").slice(2).join(" "));
    expect(form.get("total_amount")).toBe("600");
    expect(form.get("currency")).toBe("BDT");
    expect(form.get("ipn_url")).toBe("https://karigor.example.com/api/billing/notice/sslcommerz");
    expect(form.get("tran_id")).toMatch(/^p1-[0-9a-f]{12}$/);
  });

  it("counts only what its validation service confirms, for the person in the transaction id", async () => {
    const ok = ssl({ status: "VALID", tran_id: "p1-abcdef123456", amount: "600.00", currency_type: "BDT", value_a: "p1" });
    expect(await ok.p.confirm({ raw: "val_id=v1&status=VALID" })).toEqual({ ref: "sslcommerz:p1-abcdef123456", personId: "p1", usd: 5 });
    expect(ok.seen[0]).toContain("validationserverAPI.php?val_id=v1");
    expect(await ssl({ status: "INVALID_TRANSACTION" }).p.confirm({ raw: "val_id=v1" })).toBeUndefined();
    expect(await ssl({ status: "VALID", tran_id: "p1-abcdef123456", amount: "600", currency_type: "BDT", value_a: "p2" }).p.confirm({ raw: "val_id=v1" })).toBeUndefined();
    expect(await ok.p.confirm({ raw: "status=VALID" })).toBeUndefined();
  });
});

describe("credit from payments, on the server", { timeout: 60_000 }, () => {
  const open: KarigorServer[] = [];
  afterEach(async () => {
    for (const k of open.splice(0)) await new Promise((r) => k.server.close(r));
  });

  it("adds a confirmed payment once, whatever the notice says about itself, and offers only the set amounts", async () => {
    const root = await mkdtemp(join(tmpdir(), "karigor-billing-"));
    const people = new People(root);
    const { person, token } = await people.add("Rina", { email: "rina@example.com" });
    const paddle = new PaddleProvider({ apiKey: "k", productId: "p", webhookSecret: SECRET, now: () => Date.now() });
    const k = createKarigorServer({ root, adapter: "demo", token: "admin-token", metered: { marginPct: 20 }, billing: { providers: [paddle], packs: [5, 10] } });
    open.push(k);
    await new Promise<void>((r) => k.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(k.server.address() as AddressInfo).port}`;
    const notice = paddleNotice(completed(person.id, "1000"), { ts: Math.floor(Date.now() / 1000) });
    const post = () => fetch(`${base}/api/billing/notice/paddle`, { method: "POST", headers: notice.headers, body: notice.raw });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(balanceOf((await people.byId(person.id))!)).toBe(10);
    // a forged notice is answered the same but adds nothing
    await fetch(`${base}/api/billing/notice/paddle`, { method: "POST", headers: { "paddle-signature": "ts=1;h1=00" }, body: notice.raw });
    expect(balanceOf((await people.byId(person.id))!)).toBe(10);
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const offer = await (await fetch(`${base}/api/billing`, { headers: auth })).json();
    expect(offer).toEqual({ packs: [5, 10], providers: [{ name: "paddle", label: "Card or wallet (worldwide)" }], creditUsd: 10 });
    const bad = await fetch(`${base}/api/billing/checkout`, { method: "POST", headers: auth, body: JSON.stringify({ usd: 7, provider: "paddle" }) });
    expect(bad.status).toBe(400);
  });
});
