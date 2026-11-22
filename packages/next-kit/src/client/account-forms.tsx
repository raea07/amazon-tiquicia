"use client";

import { Alert, Badge, buttonClass, TextField } from "@yuntera/ui";
import Link from "next/link";
import { useActionState, useState } from "react";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES } from "../auth-rules";
import {
  changePassword,
  confirmEmailCode,
  confirmEmailLink,
  confirmEnrolment,
  deleteAccount,
  removeSecondFactor,
  requestPasswordReset,
  resendConfirmation,
  setNewPassword,
  startEnrolment,
  verifyRecoveryCode,
  verifySecondFactor,
} from "../server/account-actions";
import type { ActionState } from "../types";
import { FormMessage, SubmitButton } from "./forms";
import { HumanCheck } from "./human-check";

const initial: ActionState = {};

/** The 6-digit code field: digits keyboard on phones, and the code from an SMS or app offered. */
export function CodeField({
  label = "Código de 6 dígitos",
  hint,
  name = "code",
}: {
  label?: string;
  hint?: string;
  name?: string;
}) {
  return (
    <TextField
      label={label}
      hint={hint}
      name={name}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 \-]{6,7}"
      maxLength={7}
      className="max-w-48"
    />
  );
}

/**
 * The password rules, shown before anything is sent and ticked off as the
 * person types. Each line says in words whether it is met: colour is never the
 * only signal.
 */
export function PasswordRules({ password, repeat }: { password: string; repeat?: string }) {
  const lengthOk = [...password].length >= PASSWORD_MIN_LENGTH;
  const rows = [
    { text: PASSWORD_RULES[0], ok: lengthOk, checked: true },
    { text: PASSWORD_RULES[1], ok: true, checked: false },
    ...(repeat === undefined
      ? []
      : [
          {
            text: "Las dos contraseñas iguales.",
            ok: repeat !== "" && repeat === password,
            checked: true,
          },
        ]),
  ];
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Requisitos de la contraseña">
      {rows.map((row) => (
        <li key={row.text} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              row.checked && row.ok ? "bg-success text-on-brand" : "border border-border-strong"
            }`}
          >
            {row.checked && row.ok ? "✓" : ""}
          </span>
          <span className={row.checked && row.ok ? "text-ink" : "text-ink-muted"}>
            {row.text}
            {row.checked ? (
              <span className="sr-only">{row.ok ? " Cumple." : " Todavía no cumple."}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** New password twice, with the rules underneath. */
function NewPasswordFields({ label = "Contraseña nueva" }: { label?: string }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  return (
    <>
      <TextField
        label={label}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <TextField
        label="Escríbala de nuevo"
        name="repeat"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(event) => setRepeat(event.target.value)}
      />
      <PasswordRules password={password} repeat={repeat} />
    </>
  );
}

// ── Password reset ──────────────────────────────────────────────────────────

/**
 * "Olvidé mi contraseña": the address first; then, on the same screen, the
 * code from the e-mail for anyone who would rather type it than follow the
 * link (the native apps always do).
 */
export function RecoveryForm() {
  const [sent, send] = useActionState(requestPasswordReset, initial);
  const [checked, check] = useActionState(verifyRecoveryCode, initial);
  const email = sent.values?.email ?? "";

  if (sent.step !== "code") {
    return (
      <form action={send} className="flex flex-col gap-4">
        <TextField
          label="Correo electrónico de su cuenta"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          defaultValue={sent.values?.email}
        />
        <HumanCheck resetKey={sent} />
        <FormMessage state={sent} />
        <SubmitButton block size="lg" pendingLabel="Enviando…">
          Enviarme un enlace
        </SubmitButton>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Alert tone="success" title="Revise su correo">
        {sent.ok}
      </Alert>
      <form action={check} className="flex flex-col gap-4 border-t border-border pt-5">
        <p className="text-sm">
          Abra el enlace del correo, o escriba aquí el código de 6 dígitos que trae.
        </p>
        <input type="hidden" name="email" value={email} />
        <CodeField />
        <FormMessage state={checked} />
        <SubmitButton block pendingLabel="Comprobando…">
          Continuar con el código
        </SubmitButton>
      </form>
      <form action={send} className="flex flex-col gap-2">
        <input type="hidden" name="email" value={email} />
        <HumanCheck resetKey={sent} />
        <SubmitButton variant="ghost" size="sm" pendingLabel="Enviando…">
          Enviarme otro correo
        </SubmitButton>
      </form>
    </div>
  );
}

/** The page an e-mail link opens: one button, so a mail scanner opening the link changes nothing. */
export function ConfirmLinkForm({
  tokenHash,
  type,
  button,
}: {
  tokenHash: string;
  type: string;
  button: string;
}) {
  const [state, action] = useActionState(confirmEmailLink, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {state.error ? (
        <Alert tone="danger" title="Este enlace ya no sirve">
          <p>{state.error}</p>
          <p className="mt-2">
            <Link
              href={type === "recovery" ? "/recuperar" : "/ingresar"}
              className="font-semibold underline"
            >
              {type === "recovery"
                ? "Pedir otro correo para restablecer"
                : "Ir a ingresar y pedir otro"}
            </Link>
          </p>
        </Alert>
      ) : (
        <SubmitButton block size="lg" pendingLabel="Comprobando…">
          {button}
        </SubmitButton>
      )}
    </form>
  );
}

/** The last step of a reset. `needsCode`: the account has an authenticator, asked here too. */
export function NewPasswordForm({ needsCode, home }: { needsCode: boolean; home: string }) {
  const [state, action] = useActionState(setNewPassword, initial);
  if (state.step === "done") {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Contraseña cambiada">
          {state.ok}
        </Alert>
        <Link href={home as never} className={buttonClass({ block: true })}>
          Continuar
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <NewPasswordFields />
      {needsCode ? (
        <CodeField
          label="Código de su aplicación de autenticación"
          hint="Su cuenta tiene verificación en dos pasos: escriba el código que muestra la aplicación."
        />
      ) : null}
      <FormMessage state={state} />
      <SubmitButton block size="lg" pendingLabel="Guardando…">
        Guardar la contraseña nueva
      </SubmitButton>
    </form>
  );
}

// ── E-mail confirmation ─────────────────────────────────────────────────────

/**
 * "Revise su correo": the address it went to, the code from the e-mail, and a
 * way to ask for another within Auth's limit.
 */
export function ConfirmEmailPanel({
  email,
  message,
  tone = "info",
}: {
  email: string;
  message?: string;
  tone?: "info" | "success" | "danger";
}) {
  const [resent, resend] = useActionState(resendConfirmation, initial);
  const [checked, check] = useActionState(confirmEmailCode, initial);
  return (
    <div className="flex flex-col gap-5">
      <Alert tone={tone} title="Revise su correo">
        <p>{message ?? `Le enviamos un correo a ${email}.`}</p>
        <p className="mt-1">
          Abra el enlace que trae, o escriba aquí el código de 6 dígitos. Si no lo ve, revise el
          correo no deseado.
        </p>
      </Alert>
      <form action={check} className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <CodeField />
        <FormMessage state={checked} />
        <SubmitButton block size="lg" pendingLabel="Comprobando…">
          Confirmar mi correo
        </SubmitButton>
      </form>
      <form action={resend} className="flex flex-col gap-2 border-t border-border pt-4">
        <input type="hidden" name="email" value={email} />
        <p className="text-sm text-ink-muted">¿No le llegó?</p>
        <HumanCheck resetKey={resent} />
        <FormMessage state={resent} />
        <div>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Enviando…">
            Enviarme otro correo
          </SubmitButton>
        </div>
      </form>
      <p className="border-t border-border pt-4 text-sm">
        ¿Ya confirmó su correo en otro aparato?{" "}
        <Link href="/ingresar" className="font-semibold text-link underline">
          Ingresar
        </Link>
      </p>
    </div>
  );
}

// ── Signed in: password and second factor ───────────────────────────────────

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePassword, initial);
  return (
    <form action={action} className="flex flex-col gap-4" key={state.ok ?? "form"}>
      <TextField
        label="Contraseña actual"
        name="current"
        type="password"
        autoComplete="current-password"
      />
      <NewPasswordFields />
      <HumanCheck resetKey={state} />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Cambiar la contraseña</SubmitButton>
      </div>
    </form>
  );
}

/** The second step at sign-in. */
export function SecondFactorForm({ returnTo }: { returnTo: string }) {
  const [state, action] = useActionState(verifySecondFactor, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="siguiente" value={returnTo} />
      <CodeField
        label="Código de su aplicación de autenticación"
        hint="Abra la aplicación (por ejemplo, la de su teléfono) y escriba los 6 dígitos que muestra para Yuntera."
      />
      <FormMessage state={state} />
      <SubmitButton block size="lg" pendingLabel="Comprobando…">
        Verificar
      </SubmitButton>
    </form>
  );
}

/**
 * Enrolling an authenticator: start, scan the QR code (drawn on our server) or
 * type the key, then confirm with the first code.
 */
export function EnrolFactor({ returnTo }: { returnTo?: string }) {
  const [started, start] = useActionState(startEnrolment, initial);
  const [confirmed, confirm] = useActionState(confirmEnrolment, started);
  const scan = confirmed.data ?? started.data;

  if (!scan?.factorId) {
    return (
      <form action={start} className="flex flex-col gap-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>
            Instale en su teléfono una aplicación de autenticación, si todavía no tiene una
            (cualquiera que diga «códigos de verificación» o «TOTP»).
          </li>
          <li>Pulse «Empezar» y escanee con ella el código que aparecerá.</li>
          <li>Escriba el código de 6 dígitos que muestre la aplicación.</li>
        </ol>
        <FormMessage state={started} />
        <div>
          <SubmitButton pendingLabel="Preparando…">Empezar</SubmitButton>
        </div>
      </form>
    );
  }
  return (
    <form action={confirm} className="flex flex-col gap-4">
      <input type="hidden" name="factorId" value={scan.factorId} />
      {returnTo ? <input type="hidden" name="siguiente" value={returnTo} /> : null}
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        {/* biome-ignore lint/performance/noImgElement: an inline SVG data address, not an asset to optimise */}
        <img
          src={scan.qr}
          alt="Código QR para su aplicación de autenticación"
          width={200}
          height={200}
          className="rounded-md border border-border bg-white"
        />
        <div className="min-w-0 text-sm">
          <p>Escanee el código con la aplicación.</p>
          <p className="mt-2">Si no puede escanear, escriba esta clave en la aplicación:</p>
          <p
            className="mt-1 break-all rounded-md bg-surface-muted px-3 py-2 font-mono text-base tracking-wider"
            data-secret={scan.secret}
          >
            {scan.secret?.replace(/(.{4})/g, "$1 ").trim()}
          </p>
          <p className="mt-2 text-ink-muted">
            Guárdela solo en la aplicación: quien la tenga puede generar sus códigos.
          </p>
        </div>
      </div>
      <CodeField label="Código que muestra la aplicación" />
      <FormMessage state={confirmed} />
      <div>
        <SubmitButton pendingLabel="Comprobando…">Activar la verificación</SubmitButton>
      </div>
    </form>
  );
}

/** Removing or replacing the authenticator, each only with a fresh code from it. */
export function RemoveFactorForm() {
  const [state, action] = useActionState(removeSecondFactor, initial);
  return (
    <form action={action} className="flex flex-col gap-3">
      <CodeField
        label="Código actual de su aplicación"
        hint="Para quitar o cambiar la verificación, confirme que todavía tiene la aplicación."
      />
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          size="sm"
          variant="secondary"
          name="intent"
          value="replace"
          pendingLabel="Un momento…"
        >
          Cambiar de aplicación o teléfono
        </SubmitButton>
        <SubmitButton
          size="sm"
          variant="ghost"
          name="intent"
          value="remove"
          pendingLabel="Un momento…"
        >
          Quitar la verificación
        </SubmitButton>
      </div>
    </form>
  );
}

/** Whether the account has a second factor, as a badge with words. */
export function SecondFactorBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "neutral"}>{active ? "Activada" : "Desactivada"}</Badge>;
}

// ── Account deletion ────────────────────────────────────────────────────────

export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccount, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField
        label="Su contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        hint="La pedimos de nuevo para confirmar que es usted."
      />
      {/* Unticked by default: deleting has to be something the person does. */}
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="entiendo"
          required
          className="mt-0.5 size-5 accent-(--color-danger)"
        />
        <span>Entiendo que mi cuenta se elimina para siempre y que no se puede recuperar.</span>
      </label>
      <HumanCheck resetKey={state} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="danger" pendingLabel="Eliminando…">
          Eliminar mi cuenta para siempre
        </SubmitButton>
      </div>
    </form>
  );
}
