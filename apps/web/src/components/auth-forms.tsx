"use client";

import type { ActionState } from "@yuntera/next-kit/client";
import { TextField } from "@yuntera/ui";
import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, updateProfile } from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

export function SignInForm({ returnTo }: { returnTo: string }) {
  const [state, action] = useActionState(signIn, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
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

export function SignUpForm({ returnTo }: { returnTo: string }) {
  const [state, action] = useActionState(signUp, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
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
        hint="Al menos 8 caracteres."
      />
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
          <Link href="/ayuda#terminos" className="text-link underline">
            términos y condiciones
          </Link>{" "}
          y la{" "}
          <Link href="/ayuda#privacidad" className="text-link underline">
            política de privacidad
          </Link>
          .
        </span>
      </label>
      <FormMessage state={state} />
      <SubmitButton block size="lg" pendingLabel="Creando su cuenta…">
        Crear cuenta
      </SubmitButton>
    </form>
  );
}

export function ProfileForm({
  fullName,
  phone,
  marketingOptIn,
}: {
  fullName: string;
  phone: string;
  marketingOptIn: boolean;
}) {
  const [state, action] = useActionState(updateProfile, initial);
  return (
    <form action={action} className="flex flex-col gap-4">
      <TextField
        label="Nombre completo"
        name="fullName"
        autoComplete="name"
        defaultValue={state.values?.fullName ?? fullName}
      />
      <TextField
        label="Teléfono"
        name="phone"
        type="tel"
        inputMode="tel"
        optional
        defaultValue={state.values?.phone ?? phone}
        placeholder="8888-1234"
      />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="marketing"
          defaultChecked={state.values ? state.values.marketing === "on" : marketingOptIn}
          className="mt-0.5 size-5 accent-(--color-brand)"
        />
        <span>Quiero recibir ofertas y novedades por correo. Puede cambiarlo cuando quiera.</span>
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
      </div>
    </form>
  );
}
