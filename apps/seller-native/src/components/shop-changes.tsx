import { parsePhone } from "@yuntera/core";
import type { SellerShopChanges, ShopChangeKind } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import {
  Alert,
  Button,
  ChoiceList,
  FormMessage,
  formatDate,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { shopKey, useShop } from "@/lib/shops";
import {
  askedFor,
  CHANGE_KIND,
  CHANGE_SENT,
  CONTACT_SENT,
  checkContact,
  checkFiscal,
  checkShopName,
  latestRequest,
} from "@/lib/team";

const longDay = (value: string) =>
  formatDate(value, { day: "numeric", month: "long", year: "numeric" });

/** Every change refreshes the shop's data, as the seller centre re-renders its page. */
function useShopChange() {
  const shop = useShop();
  return useApiMutation(
    (
      api,
      input:
        | { kind: "shop_name"; tradeName: string }
        | { kind: "contact"; contactEmail: string; contactPhone: string }
        | {
            kind: "fiscal";
            taxRegime: "general" | "simplificado";
            fiscalAddress: string;
            postalCode: string | null;
            economicActivityCode: string | null;
          },
    ) => api.sellerRequestShopChange({ sellerId: shop.id, ...input }),
    { invalidates: [shopKey(shop.id)] },
  );
}

function WithdrawButton({ requestId }: { requestId: string }) {
  const shop = useShop();
  const [error, setError] = useState<string | null>(null);
  const withdraw = useApiMutation((api) => api.sellerWithdrawShopChange(requestId), {
    invalidates: [shopKey(shop.id)],
  });
  return (
    <Stack gap={2}>
      <Button
        variant="secondary"
        loading={withdraw.isPending}
        loadingLabel="Retirando…"
        testID="shop-change-withdraw"
        onPress={async () => {
          setError(null);
          try {
            await withdraw.mutateAsync(undefined);
          } catch (cause) {
            setError(messageOf(cause));
          }
        }}
      >
        Retirar la solicitud
      </Button>
      <FormMessage error={error} />
    </Stack>
  );
}

/** The latest request of one kind: waiting (with a way to withdraw it), or why it was not approved. */
export function ChangeStatus({
  changes,
  kind,
}: {
  changes: SellerShopChanges;
  kind: ShopChangeKind;
}) {
  const request = latestRequest(changes, kind);
  if (!request) return null;
  const asked = askedFor(request);
  if (request.status === "pending") {
    return (
      <Alert
        tone="info"
        title={`Cambio de ${CHANGE_KIND[kind]} en revisión`}
        testID="shop-change-pending"
      >
        <Stack gap={2}>
          <Text variant="small">
            Pidió cambiar a {asked}. Mientras lo revisamos sigue vigente lo que ya teníamos.
          </Text>
          {changes.can_request ? <WithdrawButton requestId={request.id} /> : null}
        </Stack>
      </Alert>
    );
  }
  if (request.status === "rejected") {
    return (
      <Alert tone="danger" title={`No aprobamos el cambio de ${CHANGE_KIND[kind]}`}>
        {`Pidió cambiar a ${asked}. ${request.note ?? ""}\nLo que teníamos no cambió. Puede enviar una solicitud nueva.`}
      </Alert>
    );
  }
  return request.decided_at ? (
    <Text variant="small" tint="muted">
      Último cambio de {CHANGE_KIND[kind]} aprobado el {longDay(request.decided_at)}.
    </Text>
  ) : null;
}

export function ShopNameForm() {
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const send = useShopChange();
  return (
    <Stack gap={3}>
      <TextField
        label="Nombre nuevo de la tienda"
        value={name}
        onChangeText={setName}
        maxLength={80}
        autoComplete="off"
        hint="Como lo verán los compradores. No puede parecerse a Yuntera ni a otra tienda."
        testID="shop-name-new"
      />
      <FormMessage error={result.error} ok={result.ok} testID="shop-name-message" />
      <Button
        loading={send.isPending}
        loadingLabel="Enviando…"
        testID="shop-name-submit"
        onPress={async () => {
          setResult({});
          const checked = checkShopName(name);
          if ("error" in checked) return setResult({ error: checked.error });
          try {
            await send.mutateAsync({ kind: "shop_name", tradeName: checked.tradeName });
            setName("");
            setResult({ ok: CHANGE_SENT });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Pedir el cambio de nombre
      </Button>
    </Stack>
  );
}

export function ContactForm({ email, phone }: { email: string; phone: string }) {
  const [contactEmail, setContactEmail] = useState(email);
  const [contactPhone, setContactPhone] = useState(parsePhone(phone)?.formatted ?? phone);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const send = useShopChange();
  return (
    <Stack gap={3}>
      <TextField
        label="Correo de contacto"
        value={contactEmail}
        onChangeText={setContactEmail}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        keyboardType="email-address"
        inputMode="email"
        maxLength={254}
        testID="contact-email"
      />
      <TextField
        label="Teléfono de la tienda"
        value={contactPhone}
        onChangeText={setContactPhone}
        keyboardType="phone-pad"
        inputMode="tel"
        autoComplete="off"
        placeholder="2222-3333"
        hint="Es el número al que le llamamos para confirmar un cambio de cuenta bancaria."
        testID="contact-phone"
      />
      <FormMessage error={result.error} ok={result.ok} testID="contact-message" />
      <Button
        loading={send.isPending}
        loadingLabel="Enviando…"
        testID="contact-submit"
        onPress={async () => {
          setResult({});
          const checked = checkContact({ email: contactEmail, phone: contactPhone });
          if ("error" in checked) return setResult({ error: checked.error });
          try {
            await send.mutateAsync({ kind: "contact", ...checked });
            setResult({ ok: CONTACT_SENT });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Pedir el cambio de contacto
      </Button>
    </Stack>
  );
}

export function FiscalForm({
  taxRegime: initialRegime,
  fiscalAddress: initialAddress,
  postalCode: initialPostal,
  economicActivityCode: initialActivity,
}: {
  taxRegime: "general" | "simplificado";
  fiscalAddress: string;
  postalCode: string | null;
  economicActivityCode: string | null;
}) {
  const [taxRegime, setTaxRegime] = useState<"general" | "simplificado">(initialRegime);
  const [fiscalAddress, setFiscalAddress] = useState(initialAddress);
  const [postalCode, setPostalCode] = useState(initialPostal ?? "");
  const [activity, setActivity] = useState(initialActivity ?? "");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const send = useShopChange();
  return (
    <Stack gap={3}>
      <Text variant="smallStrong">Régimen tributario</Text>
      <ChoiceList
        label="Régimen tributario"
        value={taxRegime}
        onChange={setTaxRegime}
        choices={[
          { value: "general", title: "General" },
          { value: "simplificado", title: "Simplificado" },
        ]}
        testID="fiscal-regime"
      />
      <TextField
        label="Dirección fiscal"
        value={fiscalAddress}
        onChangeText={setFiscalAddress}
        multiline
        maxLength={500}
        hint="Tal como está inscrita en Hacienda: provincia, cantón, distrito y señas."
        testID="fiscal-address"
      />
      <TextField
        label="Código postal"
        optional
        value={postalCode}
        onChangeText={setPostalCode}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={5}
        hint="Si lo deja en blanco, se mantiene el que tenemos registrado."
        testID="fiscal-postal"
      />
      <TextField
        label="Código de actividad económica"
        optional
        value={activity}
        onChangeText={setActivity}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={6}
        hint="El que le asignó Hacienda, de 4 a 6 dígitos. Si lo deja en blanco, se mantiene el registrado."
        testID="fiscal-activity"
      />
      <FormMessage error={result.error} ok={result.ok} testID="fiscal-message" />
      <Button
        loading={send.isPending}
        loadingLabel="Enviando…"
        testID="fiscal-submit"
        onPress={async () => {
          setResult({});
          const checked = checkFiscal({
            taxRegime,
            fiscalAddress,
            postalCode,
            economicActivityCode: activity,
          });
          if ("error" in checked) return setResult({ error: checked.error });
          try {
            await send.mutateAsync({ kind: "fiscal", ...checked.input });
            setResult({ ok: CHANGE_SENT });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        Pedir el cambio de datos fiscales
      </Button>
    </Stack>
  );
}
