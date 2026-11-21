import { decodePlusCode, encodePlusCode, isInCostaRica } from "@yuntera/core";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import { Alert, Button, Text, TextField } from "@yuntera/expo-kit/ui";
import * as Location from "expo-location";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

export interface Pin {
  lat: number;
  lng: number;
  plusCode: string;
}

/**
 * Marks the exact point of a delivery, as the website's PinPicker: from the
 * phone's location (asked for only when the shopper taps the button, and
 * only while the app is open) or from a Plus Code, which also works when the
 * shopper is not standing at the address.
 */
export function PinPicker({
  pin,
  onChange,
}: {
  pin: Pin | null;
  onChange: (pin: Pin | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [plus, setPlus] = useState("");

  function place(lat: number, lng: number) {
    if (!isInCostaRica({ lat, lng })) {
      onChange(null);
      setError("Esa ubicación está fuera de Costa Rica.");
      return;
    }
    onChange({ lat, lng, plusCode: encodePlusCode({ lat, lng }) });
    setError(null);
  }

  async function locateMe() {
    setLocating(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError(
          "No tenemos permiso para leer su ubicación. Puede darlo en los ajustes del teléfono o escribir el código Plus.",
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      place(position.coords.latitude, position.coords.longitude);
    } catch {
      setError("No pudimos leer su ubicación. Revise que esté activada o escriba el código Plus.");
    } finally {
      setLocating(false);
    }
  }

  function applyPlusCode() {
    const decoded = decodePlusCode(plus);
    if (!decoded) {
      onChange(null);
      setError("Ese código Plus no es válido. Tiene esta forma: 66XQWWMX+GG.");
      return;
    }
    place(decoded.lat, decoded.lng);
  }

  return (
    <View style={styles.box} role="group" aria-label="Ubicación exacta de la entrega">
      <Text variant="smallStrong">Ubicación exacta de la entrega</Text>
      <Text variant="small" tint="muted">
        Las señas ayudan al repartidor; el punto en el mapa es lo que lo lleva hasta su puerta.
      </Text>
      <Button
        variant="secondary"
        block
        loading={locating}
        loadingLabel="Buscando su ubicación…"
        onPress={locateMe}
      >
        Usar mi ubicación actual
      </Button>
      <Text variant="small" tint="muted" align="center">
        o
      </Text>
      <View style={styles.plus}>
        <TextField
          label="Código Plus"
          optional
          value={plus}
          onChangeText={setPlus}
          placeholder="66XQWWMX+GG"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.flex}
        />
        <Button variant="secondary" disabled={!plus.trim()} onPress={applyPlusCode}>
          Usar
        </Button>
      </View>
      {pin ? (
        <Alert tone="success" title="Ubicación marcada">
          {`Código Plus ${pin.plusCode} (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}).`}
        </Alert>
      ) : error ? (
        <Alert tone="danger">{error}</Alert>
      ) : (
        <Text variant="small" tint="muted">
          Si pide para otra casa, abra ese lugar en Google Maps y copie el código Plus que aparece.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  plus: { flexDirection: "row", alignItems: "flex-end", gap: space[2] },
  flex: { flex: 1 },
});
