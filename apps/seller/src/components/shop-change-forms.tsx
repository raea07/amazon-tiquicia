"use client";

import { ActionForm } from "@yuntera/next-kit/client";
import { SelectField, TextAreaField, TextField } from "@yuntera/ui";
import {
  requestContact,
  requestFiscal,
  requestShopName,
  withdrawShopChange,
} from "@/app/shop-change-actions";

export function ShopNameForm() {
  return (
    <ActionForm
      action={requestShopName}
      submit="Pedir el cambio de nombre"
      pendingLabel="Enviando…"
    >
      {(state) => (
        <TextField
          label="Nombre nuevo de la tienda"
          name="tradeName"
          maxLength={80}
          autoComplete="off"
          defaultValue={state.values?.tradeName}
          hint="Como lo verán los compradores. No puede parecerse a Yuntera ni a otra tienda."
        />
      )}
    </ActionForm>
  );
}

export function ContactForm({ email, phone }: { email: string; phone: string }) {
  return (
    <ActionForm
      action={requestContact}
      submit="Pedir el cambio de contacto"
      pendingLabel="Enviando…"
    >
      {(state) => (
        <>
          <TextField
            label="Correo de contacto"
            name="contactEmail"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            defaultValue={state.values?.contactEmail ?? email}
          />
          <TextField
            label="Teléfono de la tienda"
            name="contactPhone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="2222-3333"
            defaultValue={state.values?.contactPhone ?? phone}
            hint="Es el número al que le llamamos para confirmar un cambio de cuenta bancaria."
          />
        </>
      )}
    </ActionForm>
  );
}

export function FiscalForm({
  taxRegime,
  fiscalAddress,
  postalCode,
  economicActivityCode,
}: {
  taxRegime: "general" | "simplificado";
  fiscalAddress: string;
  postalCode: string | null;
  economicActivityCode: string | null;
}) {
  return (
    <ActionForm
      action={requestFiscal}
      submit="Pedir el cambio de datos fiscales"
      pendingLabel="Enviando…"
    >
      {(state) => (
        <>
          <SelectField
            label="Régimen tributario"
            name="taxRegime"
            defaultValue={state.values?.taxRegime ?? taxRegime}
          >
            <option value="general">General</option>
            <option value="simplificado">Simplificado</option>
          </SelectField>
          <TextAreaField
            label="Dirección fiscal"
            name="fiscalAddress"
            maxLength={500}
            defaultValue={state.values?.fiscalAddress ?? fiscalAddress}
            hint="Tal como está inscrita en Hacienda: provincia, cantón, distrito y señas."
          />
          <TextField
            label="Código postal"
            name="postalCode"
            inputMode="numeric"
            maxLength={5}
            optional
            defaultValue={state.values?.postalCode ?? postalCode ?? undefined}
            hint="Si lo deja en blanco, se mantiene el que tenemos registrado."
          />
          <TextField
            label="Código de actividad económica"
            name="economicActivityCode"
            inputMode="numeric"
            maxLength={6}
            optional
            defaultValue={state.values?.economicActivityCode ?? economicActivityCode ?? undefined}
            hint="El que le asignó Hacienda, de 4 a 6 dígitos. Si lo deja en blanco, se mantiene el registrado."
          />
        </>
      )}
    </ActionForm>
  );
}

export function WithdrawShopChangeForm({ requestId }: { requestId: string }) {
  return (
    <ActionForm
      action={withdrawShopChange}
      submit="Retirar la solicitud"
      pendingLabel="Retirando…"
      variant="secondary"
      size="sm"
      hideOnSuccess
    >
      <input type="hidden" name="requestId" value={requestId} />
    </ActionForm>
  );
}
