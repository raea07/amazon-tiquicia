import { useState } from "react";
import { View } from "react-native";
import { colors, space } from "../theme/tokens";
import { Button } from "../ui/button";
import { Alert, FormMessage } from "../ui/feedback";
import { Checkbox, TextField } from "../ui/fields";
import { Stack } from "../ui/layout";
import { Text } from "../ui/text";
import {
  type Audience,
  type ChoicesInput,
  checkChoices,
  grantedDate,
  phoneToOffer,
  saveChoices,
} from "./notification-rules";

/** What the form starts from: the API's settings, of a person or of a shop. */
export interface ChoicesSettings {
  version: number;
  email_enabled: boolean;
  email_locked: boolean;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  phone: string | null;
  commercial: { opt_in: boolean; granted_at: string | null };
}

function Choice({
  label,
  hint,
  checked,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const box = (
    <Checkbox checked={checked} onChange={disabled ? () => undefined : onChange} testID={testID}>
      <Text variant="bodyStrong">{label}</Text>
      <Text variant="small" tint="muted">
        {hint}
      </Text>
    </Checkbox>
  );
  return disabled ? (
    <View aria-disabled style={{ opacity: 0.75 }}>
      {box}
    </View>
  ) : (
    box
  );
}

/**
 * Which channels a person (or a shop) accepts for the messages about their
 * orders, the mobile number for WhatsApp and SMS, and a separate, unticked
 * consent for commercial messages: the websites' NotificationSettingsForm
 * (packages/next-kit/src/client/notification-settings.tsx), with its words.
 * Channels and consent are saved in one call; `version` makes the database
 * refuse a save from a screen opened before another change, and the form
 * then shows the settings as now stored (`reload`) instead of the stale ones.
 */
export function NotificationChoicesForm({
  settings,
  phone: initialPhone,
  audience,
  canEdit = true,
  save,
  reload,
}: {
  settings: ChoicesSettings;
  /** The number to start the field with (notification-rules.ts, phoneToOffer). */
  phone: string;
  audience: Audience;
  canEdit?: boolean;
  /** Saves and answers the settings as now stored. */
  save: (input: ChoicesInput) => Promise<ChoicesSettings>;
  /** Loads the settings as now stored, bypassing any cache. */
  reload: () => Promise<ChoicesSettings>;
}) {
  const shop = audience === "shop";
  const about = shop ? "los pedidos y los productos de su tienda" : "sus pedidos";
  const [version, setVersion] = useState(settings.version);
  const [emailLocked, setEmailLocked] = useState(settings.email_locked);
  const [email, setEmail] = useState(settings.email_locked || settings.email_enabled);
  const [whatsapp, setWhatsapp] = useState(settings.whatsapp_enabled);
  const [sms, setSms] = useState(settings.sms_enabled);
  const [push, setPush] = useState(settings.push_enabled);
  const [commercial, setCommercial] = useState(settings.commercial.opt_in);
  // The consent as stored, for the line saying when it was given.
  const [stored, setStored] = useState(settings.commercial);
  const [phone, setPhone] = useState(initialPhone);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || !canEdit) return;
    setResult({});
    const checked = checkChoices(
      { email, whatsapp, sms, push, commercial, phone },
      { audience, emailLocked, version },
    );
    if ("error" in checked) {
      setResult({ error: checked.error });
      return;
    }
    setBusy(true);
    try {
      const outcome = await saveChoices(audience, checked.input, save, reload);
      if (outcome.kind === "error") {
        setResult({ error: outcome.message });
        return;
      }
      const now = outcome.settings;
      setVersion(now.version);
      setStored(now.commercial);
      if (outcome.kind === "saved") {
        setResult({ ok: outcome.message });
        return;
      }
      // Changed elsewhere: show what is stored now, and say so.
      setEmailLocked(now.email_locked);
      setEmail(now.email_locked || now.email_enabled);
      setWhatsapp(now.whatsapp_enabled);
      setSms(now.sms_enabled);
      setPush(now.push_enabled);
      setCommercial(now.commercial.opt_in);
      setPhone(phoneToOffer(now.phone, null));
      setResult({ error: outcome.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <Text variant="heading">Avisos sobre {about}</Text>
        <Choice
          label="Correo electrónico"
          hint={
            emailLocked
              ? shop
                ? "Siempre activo: es el comprobante de cada pedido y de cada cambio en su tienda."
                : "No se puede desactivar mientras tenga un pedido en curso: los avisos de ese pedido son su comprobante."
              : "Los avisos de cada pedido le llegan siempre por correo: son su comprobante. Si lo desactiva, dejará de recibir los demás avisos, como las respuestas a sus reclamos."
          }
          checked={emailLocked ? true : email}
          onChange={setEmail}
          disabled={emailLocked || !canEdit}
          testID="notify-email"
        />
        <Choice
          label="WhatsApp"
          hint={
            shop
              ? "Le avisamos por WhatsApp de Yuntera cada pedido nuevo que deba preparar."
              : "Le avisamos por WhatsApp de Yuntera cuando recibimos su pedido, el día que va en camino y si no lo pudimos entregar."
          }
          checked={whatsapp}
          onChange={setWhatsapp}
          disabled={!canEdit}
          testID="notify-whatsapp"
        />
        {shop ? null : (
          // Shops are told by e-mail, WhatsApp and the app; SMS is only for a
          // shopper's delivery day.
          <Choice
            label="Mensaje de texto (SMS)"
            hint="Solo el día de la entrega, y solo si no le llega el aviso por WhatsApp ni en la aplicación."
            checked={sms}
            onChange={setSms}
            disabled={!canEdit}
            testID="notify-sms"
          />
        )}
        <Choice
          label="Notificaciones en la aplicación"
          hint="En los teléfonos donde haya abierto sesión en la aplicación de Yuntera."
          checked={push}
          onChange={setPush}
          disabled={!canEdit}
          testID="notify-push"
        />
        <TextField
          label={shop ? "Número de celular para WhatsApp" : "Número de celular para WhatsApp y SMS"}
          optional
          value={phone}
          onChangeText={setPhone}
          editable={canEdit}
          keyboardType="phone-pad"
          inputMode="tel"
          autoComplete="tel"
          placeholder="8888-1234"
          hint="Un celular de Costa Rica, de 8 dígitos. Solo lo usamos para estos avisos."
          testID="notify-phone"
        />
      </Stack>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.border }} />

      <Stack gap={2}>
        <Text variant="heading">Publicidad</Text>
        <Text variant="small" tint="muted">
          Aparte de los avisos {shop ? "de su tienda" : "de sus pedidos"}, podemos enviarle ofertas
          y novedades de Yuntera por correo. Es opcional: no hace falta para{" "}
          {shop ? "vender" : "comprar"}, y puede retirarlo cuando quiera, aquí o con el enlace que
          trae cada mensaje. Cada mensaje dirá que es publicidad.
        </Text>
        <Choice
          label="Acepto recibir ofertas y novedades de Yuntera por correo"
          hint={
            stored.opt_in && stored.granted_at
              ? `Lo aceptó el ${grantedDate(stored.granted_at)}. Desmarque la casilla y guarde para retirarlo.`
              : "Si no marca la casilla, no le enviaremos publicidad."
          }
          checked={commercial}
          onChange={setCommercial}
          disabled={!canEdit}
          testID="notify-commercial"
        />
      </Stack>

      {canEdit ? null : (
        <Alert tone="info">
          Solo la persona dueña o administradora de la tienda puede cambiar estas preferencias.
        </Alert>
      )}
      <FormMessage error={result.error} ok={result.ok} testID="notify-message" />
      {canEdit ? (
        <View style={{ gap: space[2] }}>
          <Button loading={busy} loadingLabel="Guardando…" onPress={submit} testID="notify-save">
            Guardar preferencias
          </Button>
        </View>
      ) : null}
    </Stack>
  );
}
