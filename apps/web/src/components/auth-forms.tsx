"use client";

import {
  type ActionState,
  SignInForm as KitSignInForm,
  SignUpForm as KitSignUpForm,
} from "@yuntera/next-kit/client";
import { TextField } from "@yuntera/ui";
import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, updateProfile } from "@/app/actions";
import { FormMessage, SubmitButton } from "./forms";

const initial: ActionState = {};

export function SignInForm({ returnTo }: { returnTo: string }) {
  return <KitSignInForm action={signIn} returnTo={returnTo} />;
}

export function SignUpForm({ returnTo }: { returnTo: string }) {
  return <KitSignUpForm action={signUp} returnTo={returnTo} />;
}

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
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
      <p className="text-sm text-ink-muted">
        La publicidad y los avisos por WhatsApp se eligen en{" "}
        <Link href="/cuenta/notificaciones" className="text-link underline">
          Notificaciones
        </Link>
        .
      </p>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
      </div>
    </form>
  );
}
