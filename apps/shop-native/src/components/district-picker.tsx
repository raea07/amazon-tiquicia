import type { District } from "@yuntera/db";
import { colors, gutter, radius, space, touchTarget } from "@yuntera/expo-kit/theme";
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  IconButton,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface Option {
  value: string;
  label: string;
  note?: string;
}

/** A labelled field that opens a searchable list in a sheet: a phone's answer to a long <select>. */
function SelectSheet({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
  testID,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const selected = options.find((option) => option.value === value);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(needle),
    );
  }, [options, filter]);

  return (
    <View style={styles.field}>
      <Text variant="smallStrong">{label}</Text>
      <Pressable
        role="button"
        aria-label={`${label}: ${selected?.label ?? "sin elegir"}. Cambiar`}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={() => {
          setFilter("");
          setOpen(true);
        }}
        style={[styles.select, disabled ? styles.disabled : null]}
        testID={testID}
      >
        <Text tint={selected ? "ink" : "muted"} style={styles.flex} numberOfLines={1}>
          {selected?.label ?? "Elija…"}
        </Text>
        <ChevronIcon size={18} color={colors.inkMuted} />
      </Pressable>
      {hint ? (
        <Text variant="small" tint="muted">
          {hint}
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.sheet} edges={["top", "bottom", "left", "right"]}>
          <View style={styles.sheetHeader}>
            <Text variant="heading" style={styles.flex}>
              {label}
            </Text>
            <IconButton label="Cerrar" onPress={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </View>
          {options.length > 12 ? (
            <View style={styles.filter}>
              <TextField
                label={`Buscar ${label.toLowerCase()}`}
                value={filter}
                onChangeText={setFilter}
                autoCorrect={false}
                testID={testID ? `${testID}-filter` : undefined}
              />
            </View>
          ) : null}
          <FlatList
            data={visible}
            keyExtractor={(option) => option.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const chosen = item.value === value;
              return (
                <Pressable
                  role="radio"
                  aria-checked={chosen}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.option, pressed ? styles.pressed : null]}
                  testID={testID ? `${testID}-option-${item.value}` : undefined}
                >
                  <View style={styles.flex}>
                    <Text variant={chosen ? "bodyStrong" : "body"}>{item.label}</Text>
                    {item.note ? (
                      <Text variant="small" tint="muted">
                        {item.note}
                      </Text>
                    ) : null}
                  </View>
                  {chosen ? <CheckIcon size={20} color={colors.brand} /> : null}
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <Text tint="muted" style={styles.empty}>
                No hay coincidencias. Revise cómo lo escribió.
              </Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

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
          note: d.zone_active ? undefined : "Aún no llegamos",
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
              : `Código postal ${selected.postal_code}. Todavía no entregamos en esta zona.`
            : undefined
        }
        testID="district"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  picker: { gap: space[4] },
  field: { gap: space[1] + 2 },
  select: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
  },
  disabled: { backgroundColor: colors.surfaceMuted, opacity: 0.7 },
  sheet: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: gutter,
    paddingRight: space[2],
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filter: { padding: gutter, paddingBottom: space[2] },
  option: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: gutter,
    paddingVertical: space[3],
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: gutter,
  },
  empty: { padding: gutter },
});
