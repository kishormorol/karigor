import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { roleLabel, roleOptions } from "@/lib/access";
import { requirePermission } from "@/server/auth";
import { findPerson } from "@/server/people";
import { AccessForms, RoleForm } from "../forms";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("manage people");
  const { id } = await params;
  const p = await findPerson(id);
  if (!p) notFound();
  const self = p.id === me.id;
  return (
    <>
      <PageHeader eyebrow="People" title={p.name} description={`${p.email} · ${roleLabel(p.role)}`} actions={<ButtonLink href="/team" variant="secondary">Back to people</ButtonLink>} />
      <div className="flex flex-wrap gap-2">
        <Badge tone={!p.active ? "neutral" : p.hasPassword ? "paid" : "partial"}>{!p.active ? "Access off" : p.hasPassword ? "Active" : "Not joined yet"}</Badge>
      </div>
      {self ? (
        <Card>
          <p className="m-0 text-sm text-ink-soft">This is you. Another admin can change your role or access.</p>
        </Card>
      ) : (
        <>
          <Card title="Role">
            <RoleForm id={p.id} role={p.role} roles={roleOptions()} />
          </Card>
          <Card title="Access">
            <AccessForms id={p.id} active={p.active} />
          </Card>
        </>
      )}
    </>
  );
}
