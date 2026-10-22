import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Button, SidebarShell } from "@/components/ui";
import { roleLabel } from "@/lib/access";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";
import { navFor } from "@/lib/nav";
import { requireUser } from "@/server/auth";
import { logoutAction } from "./actions";

export const dynamic = "force-dynamic";

/** Every signed-in page: the person is checked here, and each page still checks its own permission. */
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const path = (await headers()).get("x-pathname") ?? "/";
  return (
    <SidebarShell
      brand={APP_NAME}
      subtitle={APP_TAGLINE}
      groups={navFor(user)}
      active={path}
      user={{ name: user.name, role: roleLabel(user.role) }}
      signOut={
        <form action={logoutAction}>
          <Button type="submit" variant="secondary" full>
            Sign out
          </Button>
        </form>
      }
    >
      {children}
    </SidebarShell>
  );
}
