"use client";

import { Alert, Button, type ButtonSize, type ButtonVariant } from "@yuntera/ui";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

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
