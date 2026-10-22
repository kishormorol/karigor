"use client";
import { useActionState } from "react";
import { Alert, Field, FormStack, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui-client";
import { setPasswordAction, type WelcomeState } from "./actions";

export function WelcomeForm({ token }: { token: string }) {
  const [state, action] = useActionState<WelcomeState, FormData>(setPasswordAction.bind(null, token), {});
  return (
    <FormStack action={action}>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field label="New password" hint="At least 8 characters.">
        <Input type="password" name="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="The same password again">
        <Input type="password" name="again" autoComplete="new-password" required minLength={8} />
      </Field>
      <SubmitButton pending="Saving…" full>
        Save and sign in
      </SubmitButton>
    </FormStack>
  );
}
