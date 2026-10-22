"use client";
import { useActionState } from "react";
import { Alert, Field, FormStack, Input, Select } from "@/components/ui";
import { CopyField, SubmitButton } from "@/components/ui-client";
import { changeRoleAction, inviteAction, resetLinkAction, setActiveAction, type TeamState } from "./actions";

function Outcome({ state }: { state: TeamState }) {
  return (
    <>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}
      {state.link && <CopyField label="Link to send" value={state.link} />}
    </>
  );
}

export function InviteForm({ roles }: { roles: { value: string; label: string }[] }) {
  const [state, action] = useActionState<TeamState, FormData>(inviteAction, {});
  return (
    <FormStack action={action}>
      <Outcome state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name">
          <Input name="name" required defaultValue={state.values?.name} />
        </Field>
        <Field label="Email">
          <Input type="email" name="email" required defaultValue={state.values?.email} />
        </Field>
        <Field label="Role">
          <Select name="role" required defaultValue={state.values?.role ?? ""}>
            <option value="" disabled>
              Choose a role
            </option>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <SubmitButton pending="Adding…">Add and make a link</SubmitButton>
      </div>
    </FormStack>
  );
}

export function RoleForm({ id, role, roles }: { id: string; role: string; roles: { value: string; label: string }[] }) {
  const [state, action] = useActionState<TeamState, FormData>(changeRoleAction.bind(null, id), {});
  return (
    <FormStack action={action}>
      <Outcome state={state} />
      <Field label="Role">
        <Select name="role" defaultValue={role}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <SubmitButton variant="secondary">Change role</SubmitButton>
      </div>
    </FormStack>
  );
}

export function AccessForms({ id, active }: { id: string; active: boolean }) {
  const [linkState, linkAction] = useActionState<TeamState, FormData>(resetLinkAction.bind(null, id), {});
  const [activeState, activeAction] = useActionState<TeamState, FormData>(setActiveAction.bind(null, id, !active), {});
  return (
    <div className="flex flex-col gap-4">
      <Outcome state={linkState} />
      <Outcome state={activeState} />
      <div className="flex flex-wrap gap-2">
        {active && (
          <form action={linkAction}>
            <SubmitButton variant="secondary" pending="Making…">
              Make a password link
            </SubmitButton>
          </form>
        )}
        <form action={activeAction}>
          <SubmitButton variant={active ? "danger" : "primary"} pending="Saving…">
            {active ? "Turn off access" : "Turn access back on"}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
