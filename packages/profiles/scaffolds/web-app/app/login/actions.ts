"use server";
import { redirect } from "next/navigation";
import { login } from "@/server/auth";

export interface LoginState {
  error?: string;
  email?: string;
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const r = await login(email, String(form.get("password") ?? ""));
  if (!r.ok) return { error: r.error, email };
  redirect("/");
}
