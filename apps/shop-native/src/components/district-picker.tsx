import type { District } from "@yuntera/db";
import { space } from "@yuntera/expo-kit/theme";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SelectSheet } from "./select-sheet";

/**
 * Provincia → cantón → distrito, the way every Costa Rican form asks for a
 * place, as the website's picker. Districts we do not deliver to yet are still
 * listed (so people find theirs) and marked.
 */
export function DistrictPicker({
  districts,
  postalCode,
  onChange,
}: {
  districts: District[];
  postalCode: string;
  onChange: (postalCode: string) => void;
}) {
  const initial = districts.find((d) => d.postal_code === postalCode);
  const [province, setProvince] = useState(initial ? String(initial.province_code) : "");
  const [canton, setCanton] = useState(initial?.canton_code ?? "");

  const provinces = useMemo(
    () =>
      [...new Map(districts.map((d) => [String(d.province_code), d.province])).entries()].map(
        ([value, label]) => ({ value, label }),
      ),
    [districts],
  );
  const cantons = useMemo(
    () =>
      [
        ...new Map(
          districts
            .filter((d) => String(d.province_code) === province)
            .map((d) => [d.canton_code, d.canton]),
        ).entries(),
      ].map(([value, label]) => ({ value, label })),
    [districts, province],
  );
  const options = useMemo(
    () =>
      districts
        .filter((d) => d.canton_code === canton)
        .map((d) => ({
          value: d.postal_code,
          label: d.district,
          note: d.zone_active ? undefined : "Por ahora no entregamos",
        })),
    [districts, canton],
  );
  const selected = districts.find((d) => d.postal_code === postalCode);

  return (
    <View style={styles.picker}>
      <SelectSheet
        label="Provincia"
        value={province}
        options={provinces}
        onChange={(value) => {
          setProvince(value);
          setCanton("");
          onChange("");
        }}
        testID="province"
      />
      <SelectSheet
        label="Cantón"
        value={canton}
        options={cantons}
        disabled={!province}
        onChange={(value) => {
          setCanton(value);
          onChange("");
        }}
        testID="canton"
      />
      <SelectSheet
        label="Distrito"
        value={selected && selected.canton_code === canton ? postalCode : ""}
        options={options}
        disabled={!canton}
        onChange={onChange}
        hint={
          selected
            ? selected.zone_active
              ? `Código postal ${selected.postal_code}. Sí entregamos aquí.`
              : `Código postal ${selected.postal_code}. Por ahora no entregamos en esta zona. Elija otro distrito.`
            : undefined
        }
        testID="district"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: space[4] },
});
