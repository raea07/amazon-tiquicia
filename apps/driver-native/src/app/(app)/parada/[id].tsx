import { oneParam } from "@yuntera/expo-kit/paths";
import { colors, radius, space, tone } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ChevronIcon,
  ChoiceList,
  EmptyState,
  formatPrice,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { Stack as Nav, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { StopBadges } from "@/components/route-parts";
import { OfflineBanner, QueueCard } from "@/components/status";
import { useDriver } from "@/lib/driver";
import {
  attemptsNotice,
  checkDelivery,
  countCash,
  directionsUrl,
  FAILURE_REASONS,
  type FailureReason,
  findStop,
  googleMapsUrl,
  LOCKED_CODE_MESSAGE,
  parcels,
  placeOf,
  type ShownStop,
  skippedStopNote,
  wazeUrl,
  whatsappUrl,
} from "@/lib/route";

/** Opens another app (maps, the phone, WhatsApp). Falls back to Google Maps in the browser. */
function openOutside(url: string, fallback?: string) {
  Linking.openURL(url).catch(() => {
    if (fallback) void Linking.openURL(fallback).catch(() => undefined);
  });
}

function Directions({ stop }: { stop: ShownStop }) {
  return (
    <Card>
      {placeOf(stop) ? (
        <>
          <Text variant="smallStrong" tint="muted">
            Distrito
          </Text>
          <Text variant="subheading" testID="stop-place">
            {placeOf(stop)}
          </Text>
        </>
      ) : null}
      <Text variant="smallStrong" tint="muted">
        Señas
      </Text>
      <Text variant="subheading" testID="stop-senas">
        {stop.senas}
      </Text>
      {stop.plus_code ? (
        <Text variant="small" tint="muted">
          Código Plus {stop.plus_code}
        </Text>
      ) : null}
      <View style={styles.grid}>
        <Button
          variant="secondary"
          block
          style={styles.cell}
          onPress={() =>
            openOutside(
              directionsUrl(stop.lat, stop.lng, Platform.OS),
              googleMapsUrl(stop.lat, stop.lng),
            )
          }
          testID="stop-directions"
        >
          Cómo llegar
        </Button>
        <Button
          variant="secondary"
          block
          style={styles.cell}
          onPress={() => openOutside(wazeUrl(stop.lat, stop.lng))}
          testID="stop-waze"
        >
          Abrir en Waze
        </Button>
        {/* The copy saved for a dead zone keeps no phone for a stop already closed. */}
        {stop.phone ? (
          <>
            <Button
              variant="secondary"
              block
              style={styles.cell}
              onPress={() => openOutside(`tel:${stop.phone}`)}
              testID="stop-call"
            >
              Llamar
            </Button>
            <Button
              variant="secondary"
              block
              style={styles.cell}
              onPress={() => openOutside(whatsappUrl(stop.phone))}
              testID="stop-whatsapp"
            >
              WhatsApp
            </Button>
          </>
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Handing the parcel over. The customer reads their 4-digit code from their
 * order and the driver types it here; the server checks it. The code is kept
 * only in this form while it is on screen: it is never saved on the phone and
 * never queued, so without signal the screen says so and offers to try again
 * or to leave the stop for later.
 */
function DeliverForm({ stop }: { stop: ShownStop }) {
  const { deliver, leaveForLater, retry, refreshing } = useDriver();
  const cashDue = stop.cod_amount_minor;
  const [handed, setHanded] = useState("");
  // A large amount of change is confirmed for the amount typed; typing again asks again.
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const cash = cashDue > 0 ? countCash(cashDue, handed) : null;
  const notice = attemptsNotice(stop.pin_attempts_left);

  const submit = async () => {
    setError(null);
    setOffline(false);
    const invalid = checkDelivery({ pin, recipientName, cash, cashConfirmed });
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    const outcome = await deliver({
      stopId: stop.stop_id,
      pin: pin.replace(/\D/g, ""),
      recipientName: recipientName.trim(),
      codCollectedMinor: cash?.state === "ok" ? cash.collectedMinor : 0,
    });
    setBusy(false);
    if (outcome.kind === "delivered") {
      setPin("");
      router.dismissTo({
        pathname: "/",
        params: { aviso: outcome.routeCompleted ? "fin" : "entregado" },
      });
    } else if (outcome.kind === "offline") {
      setOffline(true);
    } else {
      if (outcome.kind === "refused" && outcome.clearPin) setPin("");
      setError(outcome.message);
    }
  };

  // A locked order takes no code at all until Central releases it, which
  // gives the shopper a new one; the day is read again to see whether it was.
  if (stop.pin_attempts_left === 0) {
    return (
      <View style={styles.deliver} testID="deliver">
        <Text variant="heading">Entregar</Text>
        <Alert tone="danger" title="Código bloqueado" testID="deliver-locked">
          <Stack gap={2}>
            <Text variant="small" style={{ color: tone.danger.fg }}>
              {LOCKED_CODE_MESSAGE}
            </Text>
            <Button
              variant="secondary"
              block
              loading={refreshing}
              loadingLabel="Revisando…"
              onPress={() => {
                setError(null);
                retry();
              }}
              testID="deliver-recheck"
            >
              Central ya lo desbloqueó: revisar de nuevo
            </Button>
          </Stack>
        </Alert>
      </View>
    );
  }

  return (
    <View style={styles.deliver} testID="deliver">
      <Text variant="heading">Entregar</Text>
      {notice ? (
        <Text variant="smallStrong" tint="danger" testID="attempts-notice">
          {notice}
        </Text>
      ) : null}
      {cash ? (
        <Stack gap={1}>
          <TextField
            label="Efectivo que le entrega el cliente"
            value={handed}
            onChangeText={(text) => {
              setHanded(text);
              setCashConfirmed(false);
            }}
            inputMode="decimal"
            keyboardType="numeric"
            hint={`Cobre ${formatPrice(cashDue)}. Cuente el dinero antes de entregar el paquete.`}
            testID="deliver-cash"
          />
          {cash.state !== "empty" ? (
            <Text
              variant="bodyStrong"
              tint={cash.state === "ok" ? "success" : "danger"}
              aria-live="polite"
              testID="deliver-change"
            >
              {cash.message}
            </Text>
          ) : null}
          {cash.state === "ok" && cash.confirm ? (
            <Checkbox
              checked={cashConfirmed}
              onChange={setCashConfirmed}
              testID="deliver-cash-confirm"
            >
              <Text>{`Sí, recibí ${formatPrice(cash.collectedMinor + cash.changeMinor)} y tengo ${formatPrice(cash.changeMinor)} para el vuelto.`}</Text>
            </Checkbox>
          ) : null}
        </Stack>
      ) : null}
      <TextField
        label="Nombre de quien recibe"
        value={recipientName}
        onChangeText={setRecipientName}
        autoComplete="off"
        autoCorrect={false}
        testID="deliver-name"
      />
      <TextField
        label="Código de entrega del cliente"
        value={pin}
        onChangeText={(text) => setPin(text.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={4}
        autoComplete="off"
        autoCorrect={false}
        secureTextEntry={false}
        hint="4 dígitos. El cliente lo ve en su pedido; pídaselo con el paquete ya en sus manos."
        testID="deliver-pin"
      />
      {offline ? (
        <Alert
          tone="warning"
          title="Sin señal: no se pudo revisar el código"
          testID="deliver-offline"
        >
          <Stack gap={2}>
            <Text variant="small" style={{ color: tone.warning.fg }}>
              El código solo se puede revisar en el servidor, así que la entrega necesita señal. No
              quedó nada guardado. Intente de nuevo, o deje esta parada pendiente y siga con la
              próxima.
            </Text>
            <Button
              variant="secondary"
              block
              loading={busy}
              loadingLabel="Verificando el código…"
              onPress={() => void submit()}
              testID="deliver-retry"
            >
              Intentar de nuevo
            </Button>
            <Button
              variant="secondary"
              block
              onPress={() => {
                setPin("");
                leaveForLater(stop.stop_id);
                router.dismissTo("/");
              }}
              testID="deliver-later"
            >
              Dejar pendiente y seguir
            </Button>
          </Stack>
        </Alert>
      ) : error ? (
        <Alert tone="danger" testID="deliver-message">
          {error}
        </Alert>
      ) : null}
      {offline ? null : (
        <Button
          size="lg"
          block
          loading={busy}
          loadingLabel="Verificando el código…"
          onPress={() => void submit()}
          testID="deliver-submit"
        >
          Entregar
        </Button>
      )}
    </View>
  );
}

function FailForm({ stop }: { stop: ShownStop }) {
  const { fail } = useDriver();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason) {
      setError("Elija por qué no se pudo entregar.");
      return;
    }
    setError(null);
    setBusy(true);
    const result = await fail(stop.stop_id, reason);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.dismissTo({
      pathname: "/",
      params: {
        aviso: result.queued ? "fallida-guardada" : result.routeCompleted ? "fin" : "fallida",
      },
    });
  };

  return (
    <View style={styles.fail}>
      <Pressable
        role="button"
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={styles.disclosure}
        testID="fail-open"
      >
        <Text variant="bodyStrong" style={styles.fill}>
          No se pudo entregar
        </Text>
        <View style={{ transform: [{ rotate: open ? "270deg" : "90deg" }] }}>
          <ChevronIcon size={20} color={colors.inkMuted} />
        </View>
      </Pressable>
      {open ? (
        <Stack gap={3}>
          <ChoiceList
            label="¿Qué pasó?"
            choices={FAILURE_REASONS.map((choice) => ({
              value: choice.value,
              title: choice.title,
            }))}
            value={reason}
            onChange={setReason}
            testID="fail-reason"
          />
          {error ? (
            <Alert tone="danger" testID="fail-message">
              {error}
            </Alert>
          ) : null}
          <Button
            variant="secondary"
            block
            loading={busy}
            loadingLabel="Guardando…"
            onPress={() => void submit()}
            testID="fail-submit"
          >
            Registrar que no se entregó
          </Button>
        </Stack>
      ) : null}
    </View>
  );
}

/** One stop, at /parada/<id>: where it is, what to collect, and what to do next. */
export default function StopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stopId = oneParam(id) ?? "";
  const driver = useDriver();
  const [arriving, setArriving] = useState(false);
  const [arriveError, setArriveError] = useState<string | null>(null);
  // The list behind this screen may be a minute old: read the stop again, so
  // what is shown here (and what the driver records) starts from the server.
  const { refresh } = driver;
  useEffect(() => {
    if (stopId) refresh();
  }, [refresh, stopId]);

  if (driver.loading) return <LoadingState label="Buscando la parada…" />;
  const found = driver.routes ? findStop(driver.routes, stopId) : null;
  if (!found) {
    return (
      <EmptyState
        title="No encontramos esa parada en su ruta"
        action={<LinkButton href="/">Volver a Mi ruta</LinkButton>}
      >
        Puede que Central la haya cambiado de ruta.
      </EmptyState>
    );
  }
  const { route, stop } = found;
  const open = stop.status === "pending" || stop.status === "arrived";

  const arrive = async () => {
    setArriveError(null);
    setArriving(true);
    const result = await driver.arrive(stop.stop_id);
    setArriving(false);
    if (result.error) setArriveError(result.error);
  };

  return (
    <Screen>
      <Nav.Screen options={{ title: `Parada ${stop.sequence}` }} />
      <OfflineBanner />
      <QueueCard />
      <Stack gap={1}>
        <Text variant="small" tint="muted">
          {`Parada ${stop.sequence} · paquete ${stop.tracking_code} · ${parcels(stop.package_count)}`}
        </Text>
        <View style={styles.titleRow}>
          <Text variant="title" style={styles.fill} testID="stop-title">
            {stop.recipient_name}
          </Text>
          <StopBadges stop={stop} />
        </View>
      </Stack>

      {/* A removed stop is not visited: no directions, no call to the customer. */}
      {stop.status === "skipped" ? null : <Directions stop={stop} />}

      {stop.cod_amount_minor > 0 && open ? (
        <Alert
          tone="warning"
          title={`Cobrar ${formatPrice(stop.cod_amount_minor)} en efectivo`}
          testID="stop-cash"
        >
          Cobre el monto completo antes de entregar; si le pagan con más, dé el vuelto de su fondo.
          Si no lo tienen completo, no entregue el paquete y regístrelo abajo.
        </Alert>
      ) : null}

      {stop.status === "skipped" ? (
        // Staff took it off the route: nothing to do at the door, and what to
        // do with the parcel depends on whether the route had started.
        <Stack gap={3}>
          <Alert tone="warning" title="Central quitó esta parada" testID="stop-closed">
            {skippedStopNote(route, stop)}
          </Alert>
          <LinkButton href="/" variant="secondary" block>
            Volver a Mi ruta
          </LinkButton>
        </Stack>
      ) : !open ? (
        <Alert tone={stop.status === "delivered" ? "success" : "warning"} testID="stop-closed">
          {`${
            stop.status === "delivered"
              ? "Esta parada ya fue entregada."
              : "Esta parada quedó como no entregada."
          }${stop.unsent ? " Se enviará cuando vuelva la señal." : ""}`}
        </Alert>
      ) : route.status !== "in_progress" ? (
        <Alert tone="info">Inicie la ruta para poder entregar.</Alert>
      ) : (
        <>
          {/* While the arrival is on its way the button stays, busy, so "guardada" never flashes. */}
          {stop.status === "pending" || arriving ? (
            <Stack gap={2}>
              {arriveError ? <Alert tone="danger">{arriveError}</Alert> : null}
              <Button
                variant="secondary"
                size="lg"
                block
                loading={arriving}
                loadingLabel="Registrando…"
                onPress={() => void arrive()}
                testID="stop-arrive"
              >
                Llegué
              </Button>
            </Stack>
          ) : (
            <Alert tone="info" testID="stop-arrived">
              {stop.unsent
                ? "Llegada guardada en el teléfono; se enviará cuando vuelva la señal. Entregue el paquete y pida el código."
                : "Llegada registrada. Entregue el paquete y pida el código."}
            </Alert>
          )}
          <DeliverForm stop={stop} />
          <FailForm stop={stop} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  cell: { flexBasis: "47%", flexGrow: 1 },
  deliver: {
    gap: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.brand,
    backgroundColor: colors.surface,
  },
  fail: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  disclosure: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[2] },
});
