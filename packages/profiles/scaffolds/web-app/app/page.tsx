import { Card, EmptyState, PageHeader, PublicShell } from "@/components/ui";

export default function HomePage() {
  return (
    <PublicShell>
      <PageHeader eyebrow="Getting started" title="It works" description="This page is the scaffold. The first backlog item replaces it." />
      <Card>
        <EmptyState title="Nothing here yet">Pages are built from the components in src/components/ui.tsx.</EmptyState>
      </Card>
    </PublicShell>
  );
}
