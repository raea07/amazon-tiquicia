"use client";

import { Alert, TextField } from "@yuntera/ui";
import { useActionState } from "react";
import type { ActionState } from "../types";
import { FormMessage, SubmitButton } from "./forms";

type FormAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

export interface NotificationSettingsValues {
  email_enabled: boolean;
  email_locked: boolean;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  phone: string | null;
  commercial: { opt_in: boolean; granted_at: string | null };
}

const initial: ActionState = {};

function Choice({
  name,
  label,
  hint,
  checked,
  disabled,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
}) {
  const id = `aviso-${name}`;
  return (
    <div className="flex min-h-11 items-start gap-3 py-1">
      <input
        id={id}
        type="checkbox"
        name={name}
        defaultChecked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-6 shrink-0 accent-(--color-brand)"
      />
      <label htmlFor={id} className="text-sm">
        <span className="block font-semibold">{label}</span>
        <span id={`${id}-hint`} className="block text-ink-muted">
          {hint}
        </span>
      </label>
    </div>
  );
}

const grantedDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CR", { dateStyle: "long", timeZone: "America/Costa_Rica" }).format(
    new Date(iso),
  );

/**
 * Which channels a person (or a shop) accepts for the messages about their
 * orders, the mobile number for WhatsApp and SMS, and a separate, unticked
 * consent for commercial messages. Shared by the shop and the seller centre.
 */
export function NotificationSettingsForm({
  action,
  settings,
  audience,
  canEdit = true,
}: {
  action: FormAction;
  settings: NotificationSettingsValues;
  audience: "shopper" | "shop";
  canEdit?: boolean;
}) {
  const [state, formAction] = useActionState(action, initial);
  const v = state.values;
  const on = (name: string, fallback: boolean) => (v ? v[name] === "on" : fallback);
  const shop = audience === "shop";
  const about = shop ? "los pedidos y los productos de su tienda" : "sus pedidos";

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-1" disabled={!canEdit}>
        <legend className="mb-2 text-lg font-bold">Avisos sobre {about}</legend>
        <Choice
          name="email"
          label="Correo electrónico"
          hint={
            settings.email_locked
              ? shop
                ? "Siempre activo: es el comprobante de cada pedido y de cada cambio en su tienda."
                : "No se puede desactivar mientras tenga un pedido en curso: los avisos de ese pedido son su comprobante."
              : "Los avisos de cada pedido le llegan siempre por correo: son su comprobante. Si lo desactiva, dejará de recibir los demás avisos, como las respuestas a sus reclamos."
          }
          checked={settings.email_locked ? true : on("email", settings.email_enabled)}
          disabled={settings.email_locked}
        />
        {settings.email_locked ? <input type="hidden" name="emailLocked" value="1" /> : null}
        <Choice
          name="whatsapp"
          label="WhatsApp"
          hint={
            shop
              ? "Le avisamos por WhatsApp de Yuntera cada pedido nuevo que deba preparar."
              : "Le avisamos por WhatsApp de Yuntera cuando recibimos su pedido, el día que va en camino y si no lo pudimos entregar."
          }
          checked={on("whatsapp", settings.whatsapp_enabled)}
        />
        <Choice
          name="sms"
          label="Mensaje de texto (SMS)"
          hint="Solo el día de la entrega, y solo si no le llega el aviso por WhatsApp ni en la aplicación."
          checked={on("sms", settings.sms_enabled)}
        />
        <Choice
          name="push"
          label="Notificaciones en la aplicación"
          hint="En los teléfonos donde haya abierto sesión en la aplicación de Yuntera."
          checked={on("push", settings.push_enabled)}
        />
        <div className="mt-3 max-w-sm">
          <TextField
            label="Número de celular para WhatsApp y SMS"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            optional
            placeholder="8888-1234"
            hint="Un celular de Costa Rica, de 8 dígitos. Solo lo usamos para estos avisos."
            defaultValue={v?.phone ?? settings.phone?.replace("+506", "") ?? ""}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 border-t border-border pt-5" disabled={!canEdit}>
        <legend className="mb-2 pt-5 text-lg font-bold">Publicidad</legend>
        <p className="text-sm text-ink-muted">
          Aparte de los avisos {shop ? "de su tienda" : "de sus pedidos"}, podemos enviarle ofertas
          y novedades de Yuntera por correo. Es opcional: no hace falta para{" "}
          {shop ? "vender" : "comprar"}, y puede retirarlo cuando quiera, aquí o con el enlace que
          trae cada mensaje. Cada mensaje dirá que es publicidad.
        </p>
        <Choice
          name="commercial"
          label="Acepto recibir ofertas y novedades de Yuntera por correo"
          hint={
            settings.commercial.opt_in && settings.commercial.granted_at
              ? `Lo aceptó el ${grantedDate(settings.commercial.granted_at)}. Desmarque la casilla y guarde para retirarlo.`
              : "Si no marca la casilla, no le enviaremos publicidad."
          }
          checked={on("commercial", settings.commercial.opt_in)}
        />
      </fieldset>

      {canEdit ? null : (
        <Alert tone="info">
          Solo la persona dueña o administradora de la tienda puede cambiar estas preferencias.
        </Alert>
      )}
      <FormMessage state={state} />
      {canEdit ? (
        <div>
          <SubmitButton pendingLabel="Guardando…">Guardar preferencias</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
