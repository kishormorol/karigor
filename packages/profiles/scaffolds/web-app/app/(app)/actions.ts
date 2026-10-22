"use server";
import { redirect } from "next/navigation";
import { logout } from "@/server/auth";

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
