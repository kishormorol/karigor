/**
 * Email and SMS. Every message is kept in the `messages` table, sent or not, so nothing is lost
 * while a service is not set up yet. Plain database functions: pages call them from server actions.
 *
 * Email goes through Resend (RESEND_API_KEY, EMAIL_FROM). SMS goes through Twilio
 * (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM) or any SMS gateway with a web address
 * (SMS_GATEWAY_URL with {to} and {text} in it, e.g. a local Bangladeshi provider).
 */
import { desc } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { messages } from "@/db/schema";
import type { Db } from "./people";

export type MessageStatus = "sent" | "not-sent" | "failed";
export interface SendResult {
  id: string;
  status: MessageStatus;
  /** Plain words: why it was not sent, or what the service said. */
  detail: string;
}

/** What sending needs from the outside world; tests pass their own. */
export interface SendDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: number;
}
const live = (): SendDeps => ({ fetch: globalThis.fetch, env: process.env, now: Date.now() });

async function record(database: Db, m: { channel: "email" | "sms"; to: string; subject?: string; body: string }, status: MessageStatus, detail: string, now: number): Promise<SendResult> {
  const id = crypto.randomUUID();
  await database.insert(messages).values({ id, channel: m.channel, to: m.to, subject: m.subject ?? null, body: m.body, status, detail, createdAt: now });
  return { id, status, detail };
}

/** Send an email, or keep it as not sent when no email service is set up yet. */
export async function sendEmail(m: { to: string; subject: string; text: string }, database: Db = defaultDb, deps: SendDeps = live()): Promise<SendResult> {
  const msg = { channel: "email" as const, to: m.to, subject: m.subject, body: m.text };
  const key = deps.env.RESEND_API_KEY;
  const from = deps.env.EMAIL_FROM;
  if (!key || !from) return record(database, msg, "not-sent", "no email service is set up yet", deps.now);
  try {
    const res = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    return res.ok ? record(database, msg, "sent", body.id ?? "sent", deps.now) : record(database, msg, "failed", body.message ?? `the email service said ${res.status}`, deps.now);
  } catch (e) {
    return record(database, msg, "failed", `could not reach the email service: ${(e as Error).message}`, deps.now);
  }
}

/** Send an SMS, or keep it as not sent when no SMS service is set up yet. */
export async function sendSms(m: { to: string; text: string }, database: Db = defaultDb, deps: SendDeps = live()): Promise<SendResult> {
  const msg = { channel: "sms" as const, to: m.to, body: m.text };
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from, SMS_GATEWAY_URL: gateway } = deps.env;
  try {
    if (sid && token && from) {
      const res = await deps.fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: m.to, From: from, Body: m.text }).toString(),
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      return res.ok ? record(database, msg, "sent", body.sid ?? "sent", deps.now) : record(database, msg, "failed", body.message ?? `the SMS service said ${res.status}`, deps.now);
    }
    if (gateway) {
      const url = gateway.replaceAll("{to}", encodeURIComponent(m.to)).replaceAll("{text}", encodeURIComponent(m.text));
      const res = await deps.fetch(url, { method: "GET" });
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return res.ok ? record(database, msg, "sent", text || "sent", deps.now) : record(database, msg, "failed", `the SMS service said ${res.status}${text ? `: ${text}` : ""}`, deps.now);
    }
  } catch (e) {
    return record(database, msg, "failed", `could not reach the SMS service: ${(e as Error).message}`, deps.now);
  }
  return record(database, msg, "not-sent", "no SMS service is set up yet", deps.now);
}

/** The latest messages, newest first, for an admin page. */
export async function listMessages(limit = 100, database: Db = defaultDb) {
  return database.select().from(messages).orderBy(desc(messages.createdAt)).limit(limit);
}
