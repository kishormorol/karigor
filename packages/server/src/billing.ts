import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A payment that the provider has confirmed: `ref` is its own id, so the same payment is counted once. */
export interface ConfirmedPayment {
  ref: string;
  personId: string;
  usd: number;
}

/** Where someone pays for credit. Credit is added only from `confirm`, which checks with the provider itself. */
export interface PaymentProvider {
  readonly name: "paddle" | "sslcommerz";
  /** Who it is for, in plain words, on the page. */
  readonly label: string;
  /** A page to pay `usd` of credit on. */
  checkout(o: { personId: string; email?: string; name: string; usd: number; returnUrl: string }): Promise<{ url: string }>;
  /** The provider's notice of a payment (a webhook or IPN), checked with the provider. Undefined when it is not a finished, genuine payment. */
  confirm(n: { headers: Record<string, string | string[] | undefined>; raw: string }): Promise<ConfirmedPayment | undefined>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Paddle Billing (paddle.com), for cards and wallets worldwide; Paddle is the seller of record, so it
 * handles sales tax and VAT. Needs an API key, a product for credit, a webhook secret, and a default
 * payment link set in Paddle's dashboard.
 */
export class PaddleProvider implements PaymentProvider {
  readonly name = "paddle" as const;
  readonly label = "Card or wallet (worldwide)";
  constructor(private readonly o: { apiKey: string; productId: string; webhookSecret: string; sandbox?: boolean; fetchImpl?: typeof fetch; now?: () => number }) {}

  private get api(): string {
    return this.o.sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
  }

  async checkout(o: { personId: string; email?: string; usd: number }): Promise<{ url: string }> {
    const res = await (this.o.fetchImpl ?? fetch)(`${this.api}/transactions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ quantity: 1, price: { name: `Karigor credit, USD ${o.usd}`, description: "Credit for building apps with Karigor", product_id: this.o.productId, unit_price: { amount: String(Math.round(o.usd * 100)), currency_code: "USD" }, tax_mode: "account_setting" } }],
        custom_data: { personId: o.personId, usd: o.usd },
        collection_mode: "automatic",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json().catch(() => ({}))) as { data?: { checkout?: { url?: string } }; error?: { detail?: string } };
    const url = j.data?.checkout?.url;
    if (!res.ok || !url) throw new Error(`Paddle did not open a checkout (${res.status}${j.error?.detail ? `: ${j.error.detail}` : ""})`);
    return { url };
  }

  /** `Paddle-Signature: ts=<unix>;h1=<hex>`, an HMAC-SHA256 of `<ts>:<raw body>`; older than 5 minutes is refused. */
  async confirm(n: { headers: Record<string, string | string[] | undefined>; raw: string }): Promise<ConfirmedPayment | undefined> {
    const sig = String(n.headers["paddle-signature"] ?? "");
    const parts = Object.fromEntries(sig.split(";").map((kv) => kv.split("=") as [string, string]));
    const ts = Number(parts["ts"]);
    if (!ts || !parts["h1"] || Math.abs((this.o.now ?? Date.now)() / 1000 - ts) > 300) return undefined;
    const want = Buffer.from(createHmac("sha256", this.o.webhookSecret).update(`${ts}:${n.raw}`).digest("hex"));
    const got = Buffer.from(parts["h1"]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
    let e: { event_type?: string; data?: { id?: string; status?: string; custom_data?: { personId?: string }; details?: { totals?: { subtotal?: string; currency_code?: string } } } };
    try {
      e = JSON.parse(n.raw);
    } catch {
      return undefined;
    }
    const d = e.data;
    if (e.event_type !== "transaction.completed" || !d?.id || !d.custom_data?.personId) return undefined;
    // The amount paid before tax, from Paddle's own totals, not from what the page asked for.
    const totals = d.details?.totals;
    if (!totals?.subtotal || totals.currency_code !== "USD") return undefined;
    return { ref: `paddle:${d.id}`, personId: d.custom_data.personId, usd: round2(Number(totals.subtotal) / 100) };
  }
}

/**
 * SSLCommerz (sslcommerz.com), for bKash, Nagad, Rocket and local cards in Bangladesh. Prices are in
 * taka at `bdtPerUsd`; credit is counted in USD. A payment counts only after SSLCommerz's own
 * validation service says it is valid.
 */
export class SslCommerzProvider implements PaymentProvider {
  readonly name = "sslcommerz" as const;
  readonly label = "bKash, Nagad or a Bangladeshi card";
  constructor(private readonly o: { storeId: string; storePassword: string; bdtPerUsd: number; publicUrl: string; sandbox?: boolean; fetchImpl?: typeof fetch }) {}

  private get host(): string {
    return this.o.sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com";
  }

  async checkout(o: { personId: string; email?: string; name: string; usd: number }): Promise<{ url: string }> {
    const base = this.o.publicUrl.replace(/\/$/, "");
    const form = new URLSearchParams({
      store_id: this.o.storeId,
      store_passwd: this.o.storePassword,
      total_amount: String(round2(o.usd * this.o.bdtPerUsd)),
      currency: "BDT",
      tran_id: `${o.personId}-${randomBytes(6).toString("hex")}`,
      success_url: `${base}/api/billing/return/sslcommerz`,
      fail_url: `${base}/api/billing/return/sslcommerz`,
      cancel_url: `${base}/api/billing/return/sslcommerz`,
      ipn_url: `${base}/api/billing/notice/sslcommerz`,
      cus_name: o.name || "Karigor user",
      cus_email: o.email || "no-email@karigor.invalid",
      cus_add1: "Bangladesh",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      cus_phone: "01700000000",
      shipping_method: "NO",
      product_name: "Karigor credit",
      product_category: "Software",
      product_profile: "non-physical-goods",
      value_a: o.personId,
      value_b: String(o.usd),
    });
    const res = await (this.o.fetchImpl ?? fetch)(`${this.host}/gwprocess/v4/api.php`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const j = (await res.json().catch(() => ({}))) as { status?: string; GatewayPageURL?: string; failedreason?: string };
    if (j.status !== "SUCCESS" || !j.GatewayPageURL) throw new Error(`SSLCommerz did not open a payment page${j.failedreason ? `: ${j.failedreason}` : ""}`);
    return { url: j.GatewayPageURL };
  }

  /** The notice (or the browser coming back) names a `val_id`; SSLCommerz's validation service says what was really paid. */
  async confirm(n: { raw: string }): Promise<ConfirmedPayment | undefined> {
    const valId = new URLSearchParams(n.raw).get("val_id");
    if (!valId) return undefined;
    const q = new URLSearchParams({ val_id: valId, store_id: this.o.storeId, store_passwd: this.o.storePassword, format: "json" });
    const res = await (this.o.fetchImpl ?? fetch)(`${this.host}/validator/api/validationserverAPI.php?${q}`, { signal: AbortSignal.timeout(30_000) });
    const v = (await res.json().catch(() => ({}))) as { status?: string; tran_id?: string; amount?: string; currency_type?: string; currency?: string; value_a?: string };
    if (!res.ok || !(v.status === "VALID" || v.status === "VALIDATED") || !v.tran_id || !v.value_a) return undefined;
    if ((v.currency_type ?? v.currency) !== "BDT") return undefined;
    // The person is also in the transaction id Karigor made, so a changed value_a cannot move credit to someone else.
    if (!v.tran_id.startsWith(`${v.value_a}-`)) return undefined;
    return { ref: `sslcommerz:${v.tran_id}`, personId: v.value_a, usd: round2(Number(v.amount) / this.o.bdtPerUsd) };
  }
}
