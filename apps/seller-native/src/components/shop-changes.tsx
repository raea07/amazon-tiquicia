import { parsePhone } from "@yuntera/core";
import type { SellerShopChanges, ShopChangeKind } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import {
  Alert,
  Button,
  Card,
  ChoiceList,
  ErrorState,
  FormMessage,
  formatDate,
  LoadingState,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import type React from "react";
import { useState } from "react";
import { logoActions } from "@/lib/logo-actions";
import { shopKey, useShop } from "@/lib/shops";
import {
  askedFor,
  CHANGE_KIND,
  CHANGE_SENT,
  CONTACT_SENT,
  checkContact,
  checkFiscal,
  checkShopName,
  descriptionStatus,
  latestRequest,
  logoStatus,
  SHOP_FACE_ADMIN_ONLY,
  SHOP_FACE_ELSEWHERE,
  type StatusText,
} from "@/lib/team";
import { RemoveLogoForm, WithdrawLogoButton } from "./logo-actions";
import { ShopDescriptionForm } from "./shop-description";

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

function WithdrawButton({
  requestId,
  testID = "shop-change-withdraw",
}: {
  requestId: string;
  testID?: string;
}) {
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
        testID={testID}
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

function StatusAlert({
  status,
  testID,
  children,
}: {
  status: StatusText;
  testID: string;
  children?: React.ReactNode;
}) {
  return (
    <Alert tone={status.tone} title={status.title} testID={testID}>
      <Stack gap={2}>
        <Text variant="small">{status.body}</Text>
        {children}
      </Stack>
    </Alert>
  );
}

/**
 * The shop's description and logo, as the seller centre's "Tienda" page shows
 * where they stand. The description is written, removed and withdrawn here;
 * a logo waiting for review is withdrawn and the current one removed here;
 * a logo is uploaded in the seller centre (the app does not use the phone's
 * photos yet), and the card says so.
 */
export function ShopFaceCard() {
  const shop = useShop();
  const [sent, setSent] = useState<string | null>(null);
  // Held here: the logo's buttons go away with what they acted on.
  const [logoDone, setLogoDone] = useState<string | null>(null);
  const front = useApiQuery(shopKey(shop.id, "front"), (api) => api.sellerShopFront(shop.id), {
    personal: true,
  });
  if (front.isPending) return <LoadingState />;
  if (front.isError) return <ErrorState error={front.error} onRetry={() => void front.refetch()} />;
  const data = front.data;
  const description = descriptionStatus(data.description_request, longDay);
  const logo = logoStatus(data);
  const canDo = logoActions(data);
  return (
    <Card testID="shop-face">
      <Text variant="heading">Descripción y logotipo</Text>
      <Text variant="bodyStrong">Descripción</Text>
      {data.description ? (
        <Text testID="shop-face-description">{data.description}</Text>
      ) : (
        <Text variant="small" tint="muted">
          Todavía no tiene descripción.
        </Text>
      )}
      {description && "note" in description ? (
        <Text variant="small" tint="muted">
          {description.note}
        </Text>
      ) : description ? (
        <StatusAlert status={description} testID="shop-face-description-status">
          {description.tone === "info" && data.can_edit && data.description_request ? (
            <WithdrawButton requestId={data.description_request.id} testID="shop-face-withdraw" />
          ) : null}
        </StatusAlert>
      ) : null}
      {/* Said while the request it describes is waiting; gone once withdrawn or decided. */}
      <FormMessage
        ok={data.description_request?.status === "pending" ? sent : null}
        testID="shop-description-result"
      />
      {data.can_edit ? (
        <ShopDescriptionForm
          onSent={setSent}
          // A new request, or a decision on one, starts the form afresh.
          key={`${data.description_request?.id ?? "none"}:${data.description_request?.status ?? ""}`}
          current={
            data.description_request?.status === "pending" ||
            data.description_request?.status === "rejected"
              ? (data.description_request.proposed.description ?? "")
              : (data.description ?? "")
          }
          hasDescription={Boolean(data.description)}
        />
      ) : null}
      <Text variant="bodyStrong">Logotipo</Text>
      {logo.waiting ? <StatusAlert status={logo.waiting} testID="shop-face-logo-waiting" /> : null}
      {logo.rejected ? (
        <StatusAlert status={logo.rejected} testID="shop-face-logo-rejected" />
      ) : null}
      <Text variant="small" tint="muted" testID="shop-face-logo">
        {logo.current}
      </Text>
      <FormMessage ok={logoDone} testID="logo-result" />
      {canDo.withdraw ? <WithdrawLogoButton onDone={setLogoDone} /> : null}
      {canDo.remove ? <RemoveLogoForm onDone={setLogoDone} /> : null}
      <Text variant="small" testID="shop-face-elsewhere">
        {data.can_edit ? SHOP_FACE_ELSEWHERE : SHOP_FACE_ADMIN_ONLY}
      </Text>
    </Card>
  );
}
