"use client";
import { useActionState } from "react";
import { Alert, Field, FormStack, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui-client";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <FormStack action={action}>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field label="Email">
        <Input type="email" name="email" autoComplete="username" required defaultValue={state.email} />
      </Field>
      <Field label="Password">
        <Input type="password" name="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton pending="Signing in…" full>
        Sign in
      </SubmitButton>
    </FormStack>
  );
}
