import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";

export default function DeniedPage() {
  return (
    <>
      <PageHeader title="Not for your role" />
      <Card>
        <EmptyState title="You do not have access to that page" action={<ButtonLink href="/">Go to Home</ButtonLink>}>
          If you need it for your work, ask an admin to change your role.
        </EmptyState>
      </Card>
    </>
  );
}
