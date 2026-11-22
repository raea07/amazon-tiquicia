import { parsePhone } from "@yuntera/core";
import { messageOf } from "@yuntera/expo-kit/api";
import { SignOutButton, useSession } from "@yuntera/expo-kit/auth";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  FormMessage,
  formatDate,
  LinkButton,
  ListRow,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { ChangeStatus, ContactForm, FiscalForm, ShopNameForm } from "@/components/shop-changes";
import { KYC_STATUS, SHOP_STATUS } from "@/lib/labels";
import {
  checkPayoutRequest,
  ID_TYPE_LABEL,
  ibanFeedback,
  type PayoutRequestInput,
} from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

const longDay = (value: string) =>
  formatDate(value, { day: "numeric", month: "long", year: "numeric" });

function Item({
  label,
  children,
  testID,
}: {
  label: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="small" tint="muted">
        {label}
      </Text>
      <Text variant="bodyStrong" testID={testID}>
        {children}
      </Text>
    </View>
  );
}

/**
 * Asks for a new payout account (the seller centre's `PayoutDetailsForm`).
 * Nothing changes until finance approves it after a phone call, and nothing
 * is sent unless the IBAN passes its check digits here first.
 */
function PayoutDetailsForm({
  hasAccount,
  currentSinpe,
}: {
  hasAccount: boolean;
  currentSinpe: string | null;
}) {
  const shop = useShop();
  const [iban, setIban] = useState("");
  const [holderName, setHolderName] = useState("");
  const [sinpe, setSinpe] = useState(
    currentSinpe ? (parsePhone(currentSinpe)?.formatted ?? "") : "",
  );
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const send = useApiMutation(
    (api, input: PayoutRequestInput) =>
      api.sellerRequestPayoutDetails({ sellerId: shop.id, ...input }),
    { invalidates: [shopKey(shop.id)] },
  );
  const feedback = ibanFeedback(iban);
  const parsedSinpe = sinpe.trim() ? parsePhone(sinpe) : null;

  if (result.ok) return <FormMessage ok={result.ok} testID="payout-request-result" />;
  return (
    <Stack gap={4}>
      <TextField
        label="Cuenta IBAN nueva"
        value={iban}
        onChangeText={setIban}
        placeholder="CR00 0000 0000 0000 0000 00"
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        hint={feedback.hint}
        error={feedback.error}
        testID="payout-iban"
      />
      <TextField
        label="A nombre de"
        value={holderName}
        onChangeText={setHolderName}
        maxLength={160}
        autoComplete="off"
        hint="El titular de la cuenta, tal como aparece en el banco. Debe ser quien vende."
        testID="payout-holder"
      />
      <TextField
        label="SINPE Móvil"
        optional
        value={sinpe}
        onChangeText={setSinpe}
        keyboardType="phone-pad"
        inputMode="tel"
        placeholder="8888-1234"
        hint={
          parsedSinpe?.kind === "mobile"
            ? `Lo guardamos como ${parsedSinpe.formatted}.`
            : "El celular con el que su negocio cobra por SINPE Móvil. Déjelo vacío si no tiene."
        }
      />
      <FormMessage error={result.error} testID="payout-request-error" />
      <Button
        loading={send.isPending}
        loadingLabel="Enviando…"
        testID="payout-request-submit"
        onPress={async () => {
          const checked = checkPayoutRequest({ iban, holderName, sinpe });
          if ("error" in checked) return setResult({ error: checked.error });
          try {
            await send.mutateAsync(checked.input);
            setResult({
              ok: "Solicitud enviada. La revisamos y le llamamos al teléfono registrado de la tienda para confirmarla.",
            });
          } catch (error) {
            setResult({ error: messageOf(error) });
          }
        }}
      >
        {hasAccount ? "Pedir el cambio de cuenta" : "Enviar mi cuenta para revisión"}
      </Button>
    </Stack>
  );
}

/** Cuenta: the shop's data as registered, where it is paid, and the way out. */
export default function AccountScreen() {
  const shop = useShop();
  const { viewer } = useSession();
  const overview = useApiQuery(shopKey(shop.id, "overview"), (api) => api.sellerOverview(shop.id), {
    personal: true,
  });
  const payout = useApiQuery(
    shopKey(shop.id, "payout-details"),
    (api) => api.sellerPayoutDetails(shop.id),
    { personal: true },
  );
  const changes = useApiQuery(
    shopKey(shop.id, "shop-changes"),
    (api) => api.sellerShopChanges(shop.id),
    { personal: true },
  );

  if (overview.isPending || payout.isPending || changes.isPending) return <LoadingState />;
  if (overview.isError)
    return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  if (payout.isError)
    return <ErrorState error={payout.error} onRetry={() => void payout.refetch()} />;
  if (changes.isError)
    return <ErrorState error={changes.error} onRetry={() => void changes.refetch()} />;

  const { seller, account } = overview.data;
  const { current, request } = payout.data;
  const status = SHOP_STATUS[seller.status];
  const kyc = KYC_STATUS[account.kyc_status];
  const shopChanges = changes.data;
  const contactPending = shopChanges.requests.some(
    (item) => item.kind === "contact" && item.status === "pending",
  );

  return (
    <Screen
      refreshing={overview.isRefetching || payout.isRefetching || changes.isRefetching}
      onRefresh={() => {
        void overview.refetch();
        void payout.refetch();
        void changes.refetch();
      }}
    >
      <Text tint="muted">Los datos de su tienda tal como los tenemos registrados.</Text>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="heading" style={{ flex: 1 }}>
            Tienda
          </Text>
          <Badge tone={status.tone}>{status.label}</Badge>
        </View>
        <Item label="Nombre">{seller.trade_name}</Item>
        <Item label="Dirección en Yuntera">/{seller.slug}</Item>
        <Item label="Correo de contacto">{account.contact_email}</Item>
        <Item label="Teléfono">
          {parsePhone(account.contact_phone)?.formatted ?? account.contact_phone}
        </Item>
        <ChangeStatus changes={shopChanges} kind="shop_name" />
        <ChangeStatus changes={shopChanges} kind="contact" />
        {shopChanges.can_request ? (
          <Stack gap={5}>
            <Stack gap={2}>
              <Text variant="bodyStrong">Cambiar el nombre de la tienda</Text>
              <Text variant="small" tint="muted">
                Lo revisamos antes de mostrarlo, para que nadie use un nombre que confunda a los
                compradores.
              </Text>
              <ShopNameForm />
            </Stack>
            <Stack gap={2}>
              <Text variant="bodyStrong">Cambiar el correo o el teléfono</Text>
              {shopChanges.payout_request_open ? (
                <Text variant="small">
                  Hay un cambio de cuenta bancaria en revisión, y lo confirmamos llamando al
                  teléfono actual. Cuando lo resolvamos podrá pedir este cambio.
                </Text>
              ) : (
                <>
                  <Text variant="small" tint="muted">
                    Lo confirmamos con usted al teléfono que ya tenemos antes de cambiarlo.
                  </Text>
                  <ContactForm email={account.contact_email} phone={account.contact_phone} />
                </>
              )}
            </Stack>
          </Stack>
        ) : null}
      </Card>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="heading" style={{ flex: 1 }}>
            Identidad fiscal
          </Text>
          <Badge tone={kyc.tone}>{kyc.label}</Badge>
        </View>
        <Item label="Nombre o razón social">{account.legal_name}</Item>
        <Item label={ID_TYPE_LABEL[account.id_type]}>{account.id_number}</Item>
        <Item label="Régimen tributario">
          {account.tax_regime === "simplificado" ? "Simplificado" : "General"}
        </Item>
        <Item label="Dirección fiscal">{account.fiscal_address}</Item>
        {account.kyc_notes ? (
          <Alert tone="warning" title="Nota de la verificación">
            {account.kyc_notes}
          </Alert>
        ) : null}
        <ChangeStatus changes={shopChanges} kind="fiscal" />
        {shopChanges.can_request ? (
          <Stack gap={2}>
            <Text variant="bodyStrong">Cambiar los datos fiscales</Text>
            <Text variant="small" tint="muted">
              Los verificamos con Hacienda antes de cambiarlos. El nombre o la razón social y la
              identificación no se cambian: si cambiaron, escríbanos desde su correo de contacto.
            </Text>
            <FiscalForm
              taxRegime={account.tax_regime}
              fiscalAddress={account.fiscal_address}
              postalCode={shopChanges.current?.fiscal.postal_code ?? null}
              economicActivityCode={shopChanges.current?.fiscal.economic_activity_code ?? null}
            />
          </Stack>
        ) : (
          <Text variant="small" tint="muted">
            Solo la persona dueña o administradora de la tienda puede pedir cambios en estos datos.
          </Text>
        )}
      </Card>

      <Card testID="payout-account">
        <Text variant="heading">Dónde le pagamos</Text>
        <Item label="Cuenta IBAN" testID="payout-iban-masked">
          {current.iban_masked ?? "Sin registrar"}
        </Item>
        <Item label="A nombre de">{current.holder_name ?? "—"}</Item>
        <Item label="SINPE Móvil">
          {current.sinpe_number
            ? (parsePhone(current.sinpe_number)?.formatted ?? current.sinpe_number)
            : "—"}
        </Item>

        {current.iban_masked !== null &&
        current.approved === false &&
        request?.status !== "pending" ? (
          <Alert
            tone="warning"
            title="Su cuenta todavía no está aprobada"
            testID="payout-unapproved"
          >
            Esta cuenta se registró antes de que revisáramos cada cuenta, así que no le podemos
            transferir a ella hasta aprobarla. Envíela abajo, tal como está, para que la confirmemos
            con usted por teléfono.
          </Alert>
        ) : null}
        {request?.status === "pending" ? (
          <Alert tone="info" title="Cambio de cuenta en revisión" testID="payout-request-pending">
            {`El ${longDay(request.requested_at)} se pidió cambiar a la cuenta ${request.iban_masked} (titular: ${request.holder_name}). Le vamos a llamar al teléfono registrado de la tienda para confirmarlo. Mientras tanto le seguimos pagando a la cuenta actual.`}
          </Alert>
        ) : null}
        {request?.status === "rejected" ? (
          <Alert tone="danger" title="No aprobamos el cambio de cuenta">
            {`Pidió cambiar a la cuenta ${request.iban_masked}. ${request.note ?? ""}\nSu cuenta actual no cambió. Puede enviar una solicitud nueva.`}
          </Alert>
        ) : null}
        {request?.status === "approved" && request.decided_at ? (
          <Text variant="small" tint="muted">
            Último cambio de cuenta aprobado el {longDay(request.decided_at)}.
          </Text>
        ) : null}

        <Text variant="bodyStrong">
          {current.iban_masked ? "Pedir un cambio de cuenta" : "Registrar su cuenta"}
        </Text>
        <Text variant="small" tint="muted">
          Por seguridad, la cuenta no cambia al enviar este formulario: cambiarla es la forma más
          común de fraude contra vendedores. Primero la confirmamos con usted por teléfono, al
          número que ya tenemos registrado. Nunca mostramos el número completo de una cuenta.
          {request?.status === "pending"
            ? " Si envía otra solicitud, reemplaza a la que está en revisión."
            : ""}
        </Text>
        {payout.data.can_request && contactPending ? (
          <Text variant="small">
            Hay un cambio del teléfono o el correo de la tienda en revisión, y confirmamos los
            cambios de cuenta llamando al teléfono registrado. Cuando lo resolvamos, o si retira esa
            solicitud, podrá pedir este cambio.
          </Text>
        ) : payout.data.can_request ? (
          <PayoutDetailsForm
            hasAccount={current.iban_masked !== null}
            currentSinpe={current.sinpe_number}
          />
        ) : (
          <Text variant="small">
            Solo la persona dueña o administradora de la tienda puede pedir un cambio de cuenta.
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="heading">¿Vende con otra identificación?</Text>
        <Text variant="small" tint="muted">
          Puede registrar otra tienda con una identificación distinta. La administra desde esta
          misma cuenta y elige en cuál trabaja.
        </Text>
        <LinkButton href="/nueva-tienda" variant="secondary" block>
          Registrar otra tienda
        </LinkButton>
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }} testID="account-links">
        <ListRow
          href="/equipo"
          title="Equipo"
          subtitle="Quién trabaja en la tienda, invitar y quitar personas"
          testID="open-team"
        />
        <Divider />
        <ListRow
          href="/notificaciones"
          title="Notificaciones de la tienda"
          subtitle="Correo, WhatsApp y publicidad"
          testID="open-shop-notifications"
        />
        <Divider />
        <ListRow
          href="/invitaciones"
          title="Invitaciones"
          subtitle="Tiendas que le invitaron a su equipo"
          testID="open-invitations"
        />
      </Card>

      <Stack gap={3}>
        <Text variant="heading">Su acceso</Text>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <ListRow
            href="/contrasena"
            title="Contraseña"
            subtitle="Al cambiarla, cerramos las demás sesiones abiertas de su cuenta."
            testID="open-password"
          />
          <Divider />
          <ListRow
            href="/eliminar-cuenta"
            title="Eliminar su cuenta"
            subtitle="Antes le explicamos qué se borra y qué debemos conservar por ley."
            testID="open-delete-account"
          />
        </Card>
      </Stack>

      <Stack gap={1}>
        {viewer?.email ? (
          <Text variant="small" tint="muted" align="center">
            Ingresó como {viewer.email}.
          </Text>
        ) : null}
        <SignOutButton testID="account-sign-out" />
      </Stack>
    </Screen>
  );
}
