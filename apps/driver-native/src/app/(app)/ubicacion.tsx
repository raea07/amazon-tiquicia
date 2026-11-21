import { oneParam } from "@yuntera/expo-kit/paths";
import { colors } from "@yuntera/expo-kit/theme";
import { Alert, Button, PinIcon, Screen, Stack, Text } from "@yuntera/expo-kit/ui";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";
import { useDriver } from "@/lib/driver";

/**
 * Our explanation before the system's location prompt, which both stores
 * expect (docs/research/expo-native-apps.md §8). Opened when the driver
 * starts a route (with `ruta`) or asks to share the position, and only while
 * the permission has not been answered. It asks for "while using the app"
 * only; nothing here asks for "always".
 */
export default function LocationScreen() {
  const params = useLocalSearchParams<{ ruta?: string }>();
  const routeId = oneParam(params.ruta);
  const { startRoute, shareLocation } = useDriver();
  const [busy, setBusy] = useState<"share" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (share: boolean) => {
    setError(null);
    setBusy(share ? "share" : "skip");
    if (routeId) {
      const failed = await startRoute(routeId);
      if (failed) {
        setBusy(null);
        setError(failed);
        return;
      }
    }
    if (share) await shareLocation();
    setBusy(null);
    router.back();
  };

  return (
    <Screen
      footer={
        <>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button
            size="lg"
            block
            loading={busy === "share"}
            loadingLabel="Un momento…"
            disabled={busy !== null}
            onPress={() => void go(true)}
            testID="location-continue"
          >
            {routeId ? "Continuar e iniciar ruta" : "Continuar"}
          </Button>
          <Button
            variant="ghost"
            block
            disabled={busy !== null}
            onPress={() => (routeId ? void go(false) : router.back())}
            testID="location-skip"
          >
            {routeId ? "Iniciar ruta sin compartir ubicación" : "Ahora no"}
          </Button>
        </>
      }
    >
      <PinIcon size={40} color={colors.brand} />
      <Text variant="title">Antes de salir: su ubicación</Text>
      <Stack gap={3}>
        <Text>
          Mientras tenga una ruta iniciada, Yuntera Ruta comparte su ubicación con Central, para que
          sepan por dónde va y puedan avisar a los clientes que esperan su entrega.
        </Text>
        <Text>
          Solo durante la ruta: se detiene sola cuando termina la última parada y al cerrar la
          sesión. No le pedimos permiso para usarla siempre.
        </Text>
        {/* Android 13 and later hide the service's notification while the app may not
            post notifications, which this build does not ask for yet: promise only
            what the driver will see. */}
        {Platform.OS === "ios" ? (
          <Text>Mientras se comparte, verá el indicador de ubicación en la parte de arriba.</Text>
        ) : (
          <Text>Mientras se comparte, la pantalla de su ruta lo indica.</Text>
        )}
        <Text variant="bodyStrong">
          Al continuar, el teléfono le preguntará si permite el acceso. Elija «Mientras se usa la
          app».
        </Text>
        <Text tint="muted">
          Si no la comparte, puede entregar igual; solo que Central no verá por dónde va.
        </Text>
      </Stack>
    </Screen>
  );
}
