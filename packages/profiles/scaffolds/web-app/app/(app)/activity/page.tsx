import { Card, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/ui-client";
import { requirePermission } from "@/server/auth";
import { listActivity } from "@/server/people";

export default async function ActivityPage() {
  await requirePermission("see activity");
  const rows = await listActivity();
  return (
    <>
      <PageHeader title="Activity" description="Who did what, newest first." />
      <Card padded={false}>
        <DataTable
          columns={[
            { key: "at", label: "When", format: "datetime" },
            { key: "who", label: "Who", filter: true },
            { key: "action", label: "What", sortable: false },
            { key: "subject", label: "Area", filter: true },
          ]}
          rows={rows.map((r) => ({ at: r.at, who: r.who, action: r.action, subject: r.subject }))}
          searchLabel="Search activity"
          emptyTitle="Nothing has happened yet"
        />
      </Card>
    </>
  );
}
