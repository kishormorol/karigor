import { describe, expect, it } from "vitest";
import { listMessages, sendEmail, sendSms, type SendDeps } from "@/server/messages";
import { testDb } from "./db";

const T = 1_800_000_000_000;
function deps(env: Record<string, string>, reply: { status?: number; json?: unknown; text?: string } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const d: SendDeps = {
    env,
    now: T,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(reply.text ?? JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
    }) as typeof fetch,
  };
  return { d, calls };
}

describe("messages", () => {
  it("without a service, an email or SMS is kept as not sent, never lost", async () => {
    const db = await testDb();
    const { d, calls } = deps({});
    expect((await sendEmail({ to: "a@b.co", subject: "Hi", text: "Body" }, db, d)).status).toBe("not-sent");
    expect((await sendSms({ to: "+8801711000000", text: "Your fee is due" }, db, d)).detail).toMatch(/no SMS service/);
    expect(calls).toHaveLength(0);
    const kept = await listMessages(10, db);
    expect(kept.map((m) => [m.channel, m.status])).toEqual(expect.arrayContaining([["email", "not-sent"], ["sms", "not-sent"]]));
  });

  it("sends email through Resend when it is set up, and keeps what the service said", async () => {
    const db = await testDb();
    const { d, calls } = deps({ RESEND_API_KEY: "re_x", EMAIL_FROM: "Clinic <hi@clinic.test>" }, { json: { id: "em_1" } });
    const r = await sendEmail({ to: "a@b.co", subject: "Receipt", text: "Paid" }, db, d);
    expect(r).toMatchObject({ status: "sent", detail: "em_1" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ from: "Clinic <hi@clinic.test>", to: ["a@b.co"], subject: "Receipt" });
    const refused = await sendEmail({ to: "a@b.co", subject: "x", text: "y" }, db, deps({ RESEND_API_KEY: "k", EMAIL_FROM: "f" }, { status: 422, json: { message: "domain not verified" } }).d);
    expect(refused).toMatchObject({ status: "failed", detail: "domain not verified" });
  });

  it("sends SMS through Twilio, or through any gateway address with {to} and {text}", async () => {
    const db = await testDb();
    const tw = deps({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+15550001" }, { json: { sid: "SM1" } });
    expect((await sendSms({ to: "+8801711000000", text: "Hello" }, db, tw.d)).detail).toBe("SM1");
    expect(tw.calls[0]!.url).toContain("/Accounts/AC1/Messages.json");
    expect(String(tw.calls[0]!.init!.body)).toContain("To=%2B8801711000000");
    const gw = deps({ SMS_GATEWAY_URL: "https://sms.example.bd/send?key=K&to={to}&msg={text}" }, { text: "1101|ok" });
    expect((await sendSms({ to: "01711000000", text: "Fee due: ৳500" }, db, gw.d)).status).toBe("sent");
    expect(gw.calls[0]!.url).toBe(`https://sms.example.bd/send?key=K&to=01711000000&msg=${encodeURIComponent("Fee due: ৳500")}`);
  });
});
