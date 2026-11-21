"use client";

import {
  type ActionState,
  SignInForm as KitSignInForm,
  SignUpForm as KitSignUpForm,
} from "@yuntera/next-kit/client";
import { TextField } from "@yuntera/ui";
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
