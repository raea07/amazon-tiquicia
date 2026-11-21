import { oneParam } from "@yuntera/expo-kit/paths";
import { space, tone } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatPrice,
  LoadingState,
  Logo,
  Screen,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { StopRow } from "@/components/route-parts";
import { OfflineBanner, QueueCard, TrackingStatus } from "@/components/status";
import { useDriver } from "@/lib/driver";
import { isOpen, nextStop, parcels, type ShownRoute, summarise } from "@/lib/route";
import { locationPermission } from "@/lib/tracking";

/** The messages a stop screen leaves when it sends the driver back here, as on the web. */
function Flash({ aviso }: { aviso: string | undefined }) {
  if (aviso === "entregado") {
    return (
      <Alert tone="success" testID="flash">
        Entrega registrada. Siga con la próxima parada.
      </Alert>
    );
  }
  if (aviso === "fallida") {
    return (
      <Alert tone="warning" testID="flash">
        Quedó registrado que no se entregó. Lleve el paquete de vuelta a la bodega.
      </Alert>
    );
  }
  if (aviso === "fallida-guardada") {
    return (
      <Alert tone="warning" testID="flash">
        Quedó guardado en el teléfono que no se entregó; se envía cuando vuelva la señal. Lleve el
        paquete de vuelta a la bodega.
      </Alert>
    );
  }
  if (aviso === "fin") {
    return (
      <Alert tone="success" title="Terminó la ruta" testID="flash">
        Regrese a la bodega para liquidar.
      </Alert>
    );
  }
  return null;
}

function RouteCard({ route }: { route: ShownRoute }) {
  const { startRoute, shareLocation, permission } = useDriver();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = summarise(route);

  const start = async () => {
    setError(null);
    // Our own explanation comes before the system's location prompt.
    const allowed = permission ?? (await locationPermission());
    if (allowed !== "granted") {
      router.push({ pathname: "/ubicacion", params: { ruta: route.route_id } });
      return;
    }
    setStarting(true);
    const failed = await startRoute(route.route_id);
    setStarting(false);
    if (failed) setError(failed);
    else void shareLocation();
  };

  return (
    <Card testID="driver-route">
      <View style={styles.routeHead}>
        <Text variant="heading" style={styles.fill}>
          Ruta {route.code}
        </Text>
        <Text variant="small" tint="muted">
          {`${summary.delivered} de ${summary.total} entregadas`}
        </Text>
      </View>

      {route.status === "assigned" ? (
        <Stack gap={2}>
          <Text>
            Recoja <Text variant="bodyStrong">{parcels(summary.packages)}</Text> en{" "}
            {route.depot.name}. Revise que cada código de paquete esté en su lista antes de salir.
          </Text>
          <Text variant="small" tint="muted">
            {route.depot.address}
          </Text>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button
            size="lg"
            block
            loading={starting}
            loadingLabel="Iniciando la ruta…"
            onPress={() => void start()}
            testID={`start-route-${route.code}`}
          >
            Ya tengo los paquetes: iniciar ruta
          </Button>
        </Stack>
      ) : null}

      {route.status === "in_progress" && !summary.finished ? (
        <TrackingStatus
          onShare={() => {
            if (permission === "granted") void shareLocation();
            else router.push("/ubicacion");
          }}
        />
      ) : null}

      {summary.finished ? (
        <Text testID={`route-done-${route.code}`}>
          {`Ruta terminada. Regrese a ${route.depot.name}${
            route.cash_to_hand_in_minor > 0 ? " y entregue el efectivo." : "."
          }`}
          {route.stops.some((stop) => stop.unsent)
            ? " Lo último que registró se enviará cuando vuelva la señal."
            : ""}
        </Text>
      ) : null}

      {route.cash_to_hand_in_minor > 0 ? (
        <View style={styles.cash} testID={`cash-${route.code}`}>
          <Text variant="small" style={styles.cashText}>
            Efectivo que lleva cobrado
          </Text>
          <Text variant="figure" style={styles.cashText}>
            {formatPrice(route.cash_to_hand_in_minor)}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * A route and its stops in order. A finished route keeps its summary and
 * folds its stops away, so the day's work stays at the top.
 */
function RouteBlock({ route }: { route: ShownRoute }) {
  const { later } = useDriver();
  const finished = route.status === "completed";
  const [showStops, setShowStops] = useState(!finished);
  const next = nextStop(route, later);
  return (
    <Stack gap={3}>
      <RouteCard route={route} />
      {finished ? (
        <Button
          variant="ghost"
          block
          aria-expanded={showStops}
          onPress={() => setShowStops(!showStops)}
          testID={`route-stops-${route.code}`}
        >
          {showStops ? "Ocultar las paradas" : `Ver las ${route.stops.length} paradas`}
        </Button>
      ) : null}
      {showStops ? (
        <View role="list" style={styles.stops} aria-label={`Paradas de la ruta ${route.code}`}>
          {route.stops.map((stop) => (
            <View role="listitem" key={stop.stop_id}>
              <StopRow
                stop={stop}
                next={route.status === "in_progress" && stop.stop_id === next?.stop_id}
                actionable={isOpen(stop)}
                later={later.has(stop.stop_id)}
                testID={`stop-${route.code}-${stop.sequence}`}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Stack>
  );
}

/** The day's work first (as the server orders it), then finished routes, the latest first. */
function orderForToday(routes: ShownRoute[]): ShownRoute[] {
  const live = routes.filter((route) => route.status !== "completed");
  const done = routes
    .filter((route) => route.status === "completed")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  return [...live, ...done];
}

/** The day: each route with its stops in order, the next one first in mind. */
export default function RouteScreen() {
  const driver = useDriver();
  const params = useLocalSearchParams<{ aviso?: string }>();
  const { routes, queue } = driver;
  const first = driver.driverName?.split(" ")[0];
  const unsent = queue.entries.filter(
    (entry) => entry.status !== "rejected" && entry.kind !== "position",
  ).length;

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      refreshing={driver.refreshing}
      onRefresh={driver.retry}
    >
      <Logo app="driver" size={30} />
      <Text variant="title">{first ? `Hola, ${first}` : "Mi ruta"}</Text>
      <Flash aviso={oneParam(params.aviso)} />
      <OfflineBanner />
      <QueueCard />

      {driver.loading ? (
        <LoadingState label="Buscando su ruta de hoy…" />
      ) : driver.error ? (
        <ErrorState error={driver.error} onRetry={driver.retry} />
      ) : !routes || routes.length === 0 ? (
        <Card testID="driver-route">
          <EmptyState title="No tiene rutas asignadas hoy">
            Cuando Central le asigne una, aparece aquí. Deslice hacia abajo para actualizar.
          </EmptyState>
        </Card>
      ) : (
        orderForToday(routes).map((route) => <RouteBlock key={route.route_id} route={route} />)
      )}

      <Stack gap={2} style={styles.signOut}>
        {unsent > 0 ? (
          <Text variant="small" tint="muted">
            Si cierra la sesión ahora, lo que está por enviar queda guardado en este teléfono y se
            envía cuando vuelva a ingresar con su cuenta.
          </Text>
        ) : null}
        <Button variant="ghost" block onPress={() => void driver.signOut()} testID="sign-out">
          Cerrar sesión
        </Button>
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  routeHead: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: space[2] },
  stops: { gap: space[3] },
  cash: { borderRadius: 8, padding: space[3], backgroundColor: tone.warning.bg, gap: 2 },
  cashText: { color: tone.warning.fg },
  signOut: { marginTop: space[4] },
});
