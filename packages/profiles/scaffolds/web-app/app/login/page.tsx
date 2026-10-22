import { redirect } from "next/navigation";
import { Card, PublicShell } from "@/components/ui";
import { APP_NAME } from "@/lib/app";
import { currentUser } from "@/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <PublicShell brand={APP_NAME}>
      <Card title="Sign in">
        <div className="flex flex-col gap-4">
          <LoginForm />
          <p className="m-0 text-sm text-muted">New here, or forgot your password? Ask an admin for a link to set one.</p>
        </div>
      </Card>
    </PublicShell>
  );
}
