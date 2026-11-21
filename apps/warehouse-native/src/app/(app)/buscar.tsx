import type { Api } from "@yuntera/db";
import { useApi } from "@yuntera/expo-kit/api";
import { BarcodeScanner, findByForms, type ScanFeedback } from "@yuntera/expo-kit/scanner";
import { colors, fontFamily, space } from "@yuntera/expo-kit/theme";
import { Card, Divider, Screen, Stack, Text } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { camera } from "@/lib/camera";
import { plural } from "@/lib/floor";
import { useWarehouse } from "@/lib/warehouse";

type Sku = NonNullable<Awaited<ReturnType<Api["wmsFindSku"]>>>;

/**
 * Stock lookup, as the web's /bodega/buscar: scan or type a barcode or a YT
 * code and see what it is, which bins of this warehouse hold it and how many.
 * A barcode is also tried at its other usual lengths, because the database
 * compares it as stored.
 */
export default function LookupScreen() {
  const api = useApi();
  const { warehouse } = useWarehouse();
  const [sku, setSku] = useState<Sku | null>(null);

  const onScan = async (code: string): Promise<ScanFeedback> => {
    const found = await findByForms(code, (form) => api.wmsFindSku(warehouse.id, form));
    if (found) {
      setSku(found);
      return { tone: "success", message: `Encontrado: ${found.title}.` };
    }
    setSku(null);
    return {
      tone: "warning",
      message: `No hay ningún producto con el código “${code}” en esta bodega.`,
    };
  };

  const total = sku?.bins.reduce((sum, bin) => sum + bin.quantity, 0) ?? 0;
  return (
    <Screen>
      <Card>
        <BarcodeScanner
          camera={camera}
          label="Código de barras o código YT"
          hint="Le decimos en qué ubicaciones está y cuántas unidades hay."
          submitLabel="Buscar"
          submittingLabel="Buscando…"
          onScan={onScan}
          testID="lookup"
        />
      </Card>

      {sku ? (
        <Card testID="lookup-result">
          <Stack gap={1}>
            <Text variant="heading">{sku.title}</Text>
            <Text variant="small" tint="muted">
              {sku.sku_code}
              {sku.gtin ? ` · ${sku.gtin}` : ""}
              {sku.variant_name ? ` · ${sku.variant_name}` : ""}
            </Text>
          </Stack>
          {sku.bins.length === 0 ? (
            <Text>No hay unidades en ninguna ubicación.</Text>
          ) : (
            <Stack gap={2}>
              {sku.bins.map((bin, index) => (
                <View key={`${bin.location_id}:${bin.seller_id}`} style={styles.binWrap}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.bin}>
                    <View style={styles.fill}>
                      <Text style={styles.binCode}>{bin.location_code}</Text>
                      <Text variant="small" tint="muted">
                        de {bin.seller_name}
                      </Text>
                    </View>
                    <Text
                      style={styles.binQuantity}
                      aria-label={plural(bin.quantity, "unidad", "unidades")}
                    >
                      {bin.quantity}
                    </Text>
                  </View>
                </View>
              ))}
              <Text variant="small" tint="muted">
                Total en bodega: {plural(total, "unidad", "unidades")}.
              </Text>
            </Stack>
          )}
          <Text variant="caption" tint="muted">
            Si lo que ve en el estante no coincide, no lo corrija a ojo: avise al encargado para que
            haga el conteo y el ajuste.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  binWrap: { gap: space[2] },
  bin: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44 },
  binCode: { fontFamily: fontFamily.display, fontWeight: "700", fontSize: 20, color: colors.ink },
  binQuantity: {
    fontFamily: fontFamily.display,
    fontWeight: "700",
    fontSize: 22,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
});
