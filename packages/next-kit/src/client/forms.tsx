"use client";

import { Alert, Button, type ButtonSize, type ButtonVariant, TextField } from "@yuntera/ui";
import { type ReactNode, useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "../types";

type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A submit button that disables itself while its form is being sent, so a
 * double tap cannot submit twice, and says so to screen readers.
 */
export function SubmitButton({
  children,
  pendingLabel = "Un momento…",
  variant,
  size,
  block,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      block={block}
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Shows the result of the last submission. Errors are announced immediately. */
export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok) return <Alert tone="success">{state.ok}</Alert>;
  return null;
}

const initial: ActionState = {};

/**
 * A small form around one action: a button (plus any fields passed as
 * children) and the outcome underneath. Most back-office actions are this.
 */
export function ActionForm({
  action,
  children,
  submit,
  pendingLabel,
  variant,
  size,
  className = "flex flex-col gap-3",
  hideOnSuccess = false,
}: {
  action: FormAction;
  children?: ReactNode | ((state: ActionState) => ReactNode);
  submit: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Replace the form with its success message once it has worked. */
  hideOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, initial);
  if (hideOnSuccess && state.ok) return <FormMessage state={state} />;
  return (
    <form action={formAction} className={className}>
      {typeof children === "function" ? children(state) : children}
      <FormMessage state={state} />
      <div>
        <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>
          {submit}
        </SubmitButton>
      </div>
    </form>
  );
}

/** E-mail and password. The action decides where to go next. */
export function SignInForm({ action, returnTo }: { action: FormAction; returnTo: string }) {
  const [state, formAction] = useActionState(action, initial);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="siguiente" value={returnTo} />
      <TextField
        label="Correo electrónico"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        defaultValue={state.values?.email}
      />
      <TextField
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
      />
      <FormMessage state={state} />
      <SubmitButton block size="lg" pendingLabel="Ingresando…">
        Ingresar
      </SubmitButton>
    </form>
  );
}
