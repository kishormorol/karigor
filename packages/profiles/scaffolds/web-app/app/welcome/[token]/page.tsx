import { Alert, Card, PublicShell } from "@/components/ui";
import { APP_NAME } from "@/lib/app";
import { roleLabel } from "@/lib/access";
import { peekLink } from "@/server/people";
import { WelcomeForm } from "./welcome-form";

export const dynamic = "force-dynamic";

export default async function WelcomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await peekLink(token);
  return (
    <PublicShell brand={APP_NAME}>
      {!link ? (
        <Card title="This link does not work any more">
          <Alert tone="warning">It has been used already, or it is more than a few days old. Ask an admin for a new link.</Alert>
        </Card>
      ) : (
        <Card title={link.purpose === "invite" ? `Welcome, ${link.person.name}` : "Choose a new password"}>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-sm text-ink-soft">
              {link.purpose === "invite" ? `You have been added as ${roleLabel(link.person.role)}. Choose a password to sign in with ${link.person.email}.` : `Choose a new password for ${link.person.email}.`}
            </p>
            <WelcomeForm token={token} />
          </div>
        </Card>
      )}
    </PublicShell>
  );
}
