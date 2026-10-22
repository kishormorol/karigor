import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader eyebrow="Getting started" title={`Hello, ${user.name}`} description="This page is the scaffold. The first backlog item replaces it." />
      <Card>
        <EmptyState title="Nothing here yet">Pages are built from the components in src/components/ui.tsx and ui-client.tsx.</EmptyState>
      </Card>
    </>
  );
}
