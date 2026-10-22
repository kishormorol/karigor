import { Card, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/ui-client";
import { roleLabel, roleOptions } from "@/lib/access";
import { requirePermission } from "@/server/auth";
import { listPeople } from "@/server/people";
import { InviteForm } from "./forms";

export default async function TeamPage() {
  await requirePermission("manage people");
  const people = await listPeople();
  return (
    <>
      <PageHeader title="People" description="Everyone who can sign in, and what each may do." />
      <Card title="Add someone">
        <InviteForm roles={roleOptions()} />
      </Card>
      <Card padded={false}>
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "email", label: "Email" },
            { key: "role", label: "Role", filter: true },
            { key: "status", label: "Status", filter: true, badge: { Active: "paid", "Not joined yet": "partial", "Access off": "neutral" } },
          ]}
          rows={people.map((p) => ({ name: p.name, email: p.email, role: roleLabel(p.role), status: !p.active ? "Access off" : p.hasPassword ? "Active" : "Not joined yet", href: `/team/${p.id}` }))}
          rowHref="href"
          searchLabel="Find someone"
        />
      </Card>
    </>
  );
}
