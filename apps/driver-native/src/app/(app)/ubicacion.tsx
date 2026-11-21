import { oneParam } from "@yuntera/expo-kit/paths";
import { colors } from "@yuntera/expo-kit/theme";
import { Alert, Button, PinIcon, Screen, Stack, Text } from "@yuntera/expo-kit/ui";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useDriver } from "@/lib/driver";
import { noticePermission } from "@/lib/notice";

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
  // Android 13+ asks a second question (the notice); say so before it appears.
  const [asksNotice, setAsksNotice] = useState(false);
  useEffect(() => {
    let active = true;
    void noticePermission().then((state) => active && setAsksNotice(state === "undetermined"));
    return () => {
      active = false;
    };
  }, []);

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
        {/* Android shows a fixed notice while the position is shared; from Android 13
            on, only once the app may post notifications, which is asked right after
            the location (lib/tracking.ts). */}
        {Platform.OS === "ios" ? (
          <Text>Mientras se comparte, verá el indicador de ubicación en la parte de arriba.</Text>
        ) : Platform.OS === "android" ? (
          <Text>
            Mientras se comparte, verá un aviso fijo de Yuntera Ruta entre sus notificaciones. No le
            enviamos ninguna otra notificación.
          </Text>
        ) : (
          <Text>Mientras se comparte, la pantalla de su ruta lo indica.</Text>
        )}
        <Text variant="bodyStrong">
          Al continuar, el teléfono le preguntará si permite el acceso. Elija «Mientras se usa la
          app».
        </Text>
        {asksNotice ? (
          <Text variant="bodyStrong" testID="location-notice-ask">
            Después le preguntará si Yuntera Ruta puede enviarle notificaciones. Elija «Permitir»
            para ver ese aviso; si no, la ubicación se comparte igual, sin el aviso.
          </Text>
        ) : null}
        <Text tint="muted">
          Si no la comparte, puede entregar igual; solo que Central no verá por dónde va.
        </Text>
      </Stack>
    </Screen>
  );
}
