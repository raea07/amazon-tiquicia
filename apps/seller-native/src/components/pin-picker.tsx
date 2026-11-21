import { colors, radius, space } from "@yuntera/expo-kit/theme";
import { Alert, Button, Text, TextField } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { readPlusCode } from "@/lib/plus-code";

export interface Pin {
  lat: number;
  lng: number;
  plusCode: string;
}

/**
 * The exact point where our driver collects the seller's parcels, from a Plus
 * Code, as the seller centre's PinPicker does. The web also offers "use my
 * current location"; this app does not ask for the phone's location (it has
 * no location permission), so the Plus Code, which Google Maps shows for any
 * place, is the one way in. It takes the short form Google Maps shows beside
 * a place ("Q4XR+RH Orosi, Cartago") as well as the full one; see
 * readPlusCode.
 */
export function PinPicker({
  pin,
  onChange,
}: {
  pin: Pin | null;
  onChange: (pin: Pin | null) => void;
}) {
  const [plus, setPlus] = useState("");
  const [error, setError] = useState<string | null>(null);

  function applyPlusCode() {
    const read = readPlusCode(plus);
    if (!read.ok) {
      onChange(null);
      setError(
        read.reason === "outside"
          ? "Esa ubicación está fuera de Costa Rica."
          : "Ese código Plus no es válido. Cópielo tal como lo muestra Google Maps, por ejemplo Q4XR+RH Orosi, o completo: 66XRQ4XR+RH.",
      );
      return;
    }
    onChange({ lat: read.point.lat, lng: read.point.lng, plusCode: read.plusCode });
    setError(null);
  }

  return (
    <View style={styles.box} role="group" aria-label="Punto exacto de recolección">
      <Text variant="smallStrong">Punto exacto de recolección</Text>
      <Text variant="small" tint="muted">
        Es adonde llega nuestro repartidor a recoger sus paquetes.
      </Text>
      <View style={styles.plus}>
        <TextField
          label="Código Plus"
          value={plus}
          onChangeText={setPlus}
          placeholder="Q4XR+RH Orosi"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.flex}
          testID="location-plus-code"
        />
        <Button
          variant="secondary"
          disabled={!plus.trim()}
          onPress={applyPlusCode}
          // Beside the field, level with it (a button starts at the top otherwise).
          style={{ alignSelf: "flex-end" }}
          testID="location-plus-apply"
        >
          Usar
        </Button>
      </View>
      {pin ? (
        <Alert tone="success" title="Punto marcado">
          {`Código Plus ${pin.plusCode} (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}).`}
        </Alert>
      ) : error ? (
        <Alert tone="danger">{error}</Alert>
      ) : (
        <Text variant="small" tint="muted">
          Abra el lugar en Google Maps y copie el código Plus que aparece en sus datos, por ejemplo
          «Q4XR+RH Orosi». Sirve así o completo.
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
