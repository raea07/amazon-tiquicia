"use client";

import {
  Alert,
  Button,
  type ButtonSize,
  type ButtonVariant,
  TextAreaField,
  TextField,
} from "@yuntera/ui";
import Link from "next/link";
import { type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "../types";
import { ConfirmEmailPanel, PasswordRules } from "./account-forms";
import { HumanCheck } from "./human-check";

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
 * Browsers clear a form when its action finishes. For forms whose fields are
 * rendered on the server (and so cannot read the action's state), this puts
 * back what the person typed whenever the action reports an error.
 */
function useRestoredValues(state: ActionState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.error || !state.values || !form.current) return;
    for (const [name, value] of Object.entries(state.values)) {
      const field = form.current.elements.namedItem(name);
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      ) {
        field.value = value;
      }
    }
  }, [state]);
  return form;
}

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
  const form = useRestoredValues(state);
  if (hideOnSuccess && state.ok) return <FormMessage state={state} />;
  return (
    <form ref={form} action={formAction} className={className}>
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

/**
 * E-mail and password. The action decides where to go next. An account whose
 * address is not confirmed yet is told so, with the code entry and a resend.
 * `notice` says why the person is here (a session that ended), above the form.
 */
export function SignInForm({
  action,
  returnTo,
  notice,
}: {
  action: FormAction;
  returnTo: string;
  notice?: string | null;
}) {
  const [state, formAction] = useActionState(action, initial);
  if (state.step === "confirm-email" && state.values?.email) {
    return (
      <ConfirmEmailPanel
        email={state.values.email}
        tone="danger"
        message={`${state.error ?? ""} Lo enviamos a ${state.values.email}.`}
      />
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {notice && !state.error ? (
        <Alert tone="info" title="Ingrese de nuevo">
          {notice}
        </Alert>
      ) : null}
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
      <HumanCheck resetKey={state} />
      <FormMessage state={state} />
      <SubmitButton block size="lg" pendingLabel="Ingresando…">
        Ingresar
      </SubmitButton>
      <Link
        href="/recuperar"
        className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-link underline"
      >
        Olvidé mi contraseña
      </Link>
    </form>
  );
}

/**
 * Creates an account. `legalBase` is the address of the shop, where the terms
 * and the privacy policy live (empty when this form is on the shop itself).
 */
export function SignUpForm({
  action,
  returnTo,
  legalBase = "",
}: {
  action: FormAction;
  returnTo: string;
  legalBase?: string;
}) {
  const [state, formAction] = useActionState(action, initial);
  const [password, setPassword] = useState("");
  if (state.step === "confirm-email" && state.values?.email) {
    return <ConfirmEmailPanel email={state.values.email} tone="success" message={state.ok} />;
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="siguiente" value={returnTo} />
      <TextField
        label="Nombre completo"
        name="fullName"
        autoComplete="name"
        defaultValue={state.values?.fullName}
      />
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
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <PasswordRules password={password} />
      {/* Unticked by default: consent has to be something the person does. */}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="acepta"
          required
          className="mt-0.5 size-5 accent-(--color-brand)"
        />
        <span>
          Acepto los{" "}
          <a href={`${legalBase}/ayuda#terminos`} className="text-link underline">
            términos y condiciones
          </a>{" "}
          y la{" "}
          <a href={`${legalBase}/ayuda#privacidad`} className="text-link underline">
            política de privacidad
          </a>
          .
        </span>
      </label>
      <HumanCheck resetKey={state} />
      <FormMessage state={state} />
      <SubmitButton block size="lg" pendingLabel="Creando su cuenta…">
        Crear cuenta
      </SubmitButton>
    </form>
  );
}

/**
 * A yes-or-no decision with a written note: approve or reject, act or dismiss.
 * The chosen button is sent as `decision` ("yes" or "no"), the note as `note`.
 */
export function DecisionForm({
  action,
  children,
  noteLabel,
  noteHint,
  noteOptional = true,
  yes,
  no,
}: {
  action: FormAction;
  /** Hidden fields that say what is being decided. */
  children?: ReactNode;
  noteLabel: string;
  noteHint?: string;
  noteOptional?: boolean;
  yes: string;
  no: string;
}) {
  const [state, formAction] = useActionState(action, initial);
  const form = useRestoredValues(state);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form ref={form} action={formAction} className="flex flex-col gap-3">
      {children}
      <TextAreaField
        label={noteLabel}
        name="note"
        rows={2}
        hint={noteHint}
        optional={noteOptional}
      />
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" name="decision" value="yes" pendingLabel="Guardando…">
          {yes}
        </SubmitButton>
        <SubmitButton
          size="sm"
          variant="secondary"
          name="decision"
          value="no"
          pendingLabel="Guardando…"
        >
          {no}
        </SubmitButton>
      </div>
    </form>
  );
}
