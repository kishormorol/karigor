"use server";
import { redirect } from "next/navigation";
import { startSession } from "@/server/auth";
import { redeemLink } from "@/server/people";

export interface WelcomeState {
  error?: string;
}

export async function setPasswordAction(token: string, _prev: WelcomeState, form: FormData): Promise<WelcomeState> {
  const r = await redeemLink(token, String(form.get("password") ?? ""), String(form.get("again") ?? ""));
  if (!r.ok) return { error: r.error };
  await startSession(r.session.token);
  redirect("/");
}
