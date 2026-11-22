import { useApiQuery } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import { Card, ChoiceList, Divider, formatPrice, Text, TextField } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SelectSheet } from "@/components/select";
import {
  type CategoryOption,
  categoryOptions,
  METHOD_LABEL,
  type PreviewMethod,
  previewFees,
} from "@/lib/fees";

/** The categories a product can be filed under; shared by everyone, so cached for an hour. */
export function useCategoryOptions(alsoOffer?: string) {
  const categories = useApiQuery(["categories"], (api) => api.listCategories(), {
    staleTime: 60 * 60_000,
  });
  return {
    ...categories,
    options: categories.data ? categoryOptions(categories.data, alsoOffer) : [],
  };
}

export function CategoryField({
  options,
  value,
  onChange,
  hint,
}: {
  options: CategoryOption[];
  value: string;
  onChange: (slug: string) => void;
  hint?: string;
}) {
  return (
    <SelectSheet
      label="Categoría"
      value={value}
      onChange={onChange}
      hint={hint}
      testID="category"
      // Each one says which department it belongs to: commission is set per department.
      options={options.map((option) => ({
        value: option.slug,
        label: option.name,
        note: option.group === option.name ? undefined : option.group,
      }))}
    />
  );
}

export interface PackageValues {
  weightGrams: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
}

/** Weight and size of the package, already packed for shipping. */
export function PackageFields({
  values,
  onChange,
}: {
  values: PackageValues;
  onChange: (name: keyof PackageValues, value: string) => void;
}) {
  const field = (name: keyof PackageValues, label: string) => (
    <TextField
      label={label}
      value={values[name]}
      onChangeText={(text) => onChange(name, text)}
      keyboardType={name === "weightGrams" ? "number-pad" : "decimal-pad"}
      inputMode={name === "weightGrams" ? "numeric" : "decimal"}
      style={styles.half}
      testID={`package-${name}`}
    />
  );
  return (
    <View style={styles.grid}>
      {field("weightGrams", "Peso (g)")}
      {field("lengthCm", "Largo (cm)")}
      {field("widthCm", "Ancho (cm)")}
      {field("heightCm", "Alto (cm)")}
    </View>
  );
}

/**
 * What the seller keeps from one sale, itemised, before anything is saved:
 * the seller centre's `FeePreview`, computed by the same code in packages/core
 * (see lib/fees.ts). Starts on SINPE Móvil, as the web does.
 */
export function FeePreviewCard({
  priceText,
  topCategory,
  byPlatform,
  weightGrams,
  longestSideCm,
}: {
  priceText: string;
  topCategory: string | null;
  byPlatform: boolean;
  weightGrams: number;
  longestSideCm: number;
}) {
  const [method, setMethod] = useState<PreviewMethod>("sinpe_movil");
  const preview = previewFees({
    priceText,
    topCategory,
    byPlatform,
    weightGrams,
    longestSideCm,
    method,
  });
  return (
    <Card testID="fee-preview">
      <Text variant="heading">Lo que usted recibe por venta</Text>
      {preview.state === "oversize" ? (
        <Text tint="warning">
          Este paquete es más grande de lo que nuestra bodega maneja. Elija “Usted despacha”.
        </Text>
      ) : preview.state === "incomplete" ? (
        <Text variant="small" tint="muted">
          {preview.needs}
        </Text>
      ) : (
        <View style={styles.rows} aria-live="polite">
          {preview.rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text variant="small" tint="muted" style={styles.flex}>
                {row.label}
              </Text>
              <Text variant="small" style={styles.tabular}>
                {row.amountMinor < 0
                  ? `− ${formatPrice(-row.amountMinor)}`
                  : formatPrice(row.amountMinor)}
              </Text>
            </View>
          ))}
          <Divider />
          <View style={styles.row}>
            <Text variant="bodyStrong" style={styles.flex}>
              Usted recibe
            </Text>
            <Text variant="bodyStrong" style={styles.tabular} testID="fee-payout">
              {formatPrice(preview.payoutMinor)}
            </Text>
          </View>
        </View>
      )}
      {preview.state === "ready" ? (
        <Text variant="smallStrong">Si el comprador paga con</Text>
      ) : null}
      {preview.state === "ready" ? (
        <ChoiceList
          label="Si el comprador paga con"
          value={method}
          onChange={setMethod}
          testID="fee-method"
          choices={(Object.keys(METHOD_LABEL) as PreviewMethod[]).map((value) => ({
            value,
            title: METHOD_LABEL[value],
          }))}
        />
      ) : null}
      <Text variant="caption" tint="muted">
        Estimación para una unidad, con la tarifa vigente. El costo de cobro es lo que cobra el
        medio de pago y se traslada sin recargo. El IVA del producto ya está dentro de su precio y
        usted lo declara.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  half: { flexGrow: 1, flexBasis: 140 },
  rows: { gap: space[2] },
  row: { flexDirection: "row", alignItems: "baseline", gap: space[3] },
  flex: { flex: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
});
