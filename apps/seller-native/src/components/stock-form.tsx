import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { space } from "@yuntera/expo-kit/theme";
import { Button, FormMessage, Stack, Text, TextField } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import { checkStock } from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

type Result = { ok?: string; error?: string };

/**
 * The units the seller has at one of their own places, set to what they count
 * (the seller centre's `StockForm`). Used on an offer's screen and in Inventario.
 */
export function StockForm({
  warehouseId,
  skuId,
  place,
  onHand,
  reserved,
  product,
}: {
  warehouseId: string;
  skuId: string;
  place: string;
  onHand: number;
  reserved: number;
  /** Read by screen readers so each row's field is told apart in a list. */
  product?: string;
}) {
  const id = `${warehouseId}-${skuId}`;
  const shop = useShop();
  const [quantity, setQuantity] = useState(String(onHand));
  const [result, setResult] = useState<Result>({});
  const save = useApiMutation(
    (api, units: number) => api.sellerSetStock(warehouseId, skuId, units),
    { invalidates: [shopKey(shop.id)] },
  );
  return (
    <Stack gap={3}>
      <Text variant="small" tint="muted">
        {/* In Inventario the place is the heading of the list already. */}
        {product ? "" : `En ${place}. `}
        {reserved > 0 ? `${reserved} apartadas para pedidos.` : "Ninguna apartada para pedidos."}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2] }}>
        <TextField
          label="Unidades que tiene"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
          inputMode="numeric"
          style={{ flex: 1 }}
          aria-label={product ? `Unidades de ${product} en ${place}` : `Unidades en ${place}`}
          testID={`stock-quantity-${id}`}
        />
        <Button
          variant="secondary"
          loading={save.isPending}
          loadingLabel="…"
          // Beside the field, level with it (a button starts at the top otherwise).
          style={{ alignSelf: "flex-end" }}
          testID={`stock-save-${id}`}
          onPress={async () => {
            const checked = checkStock(quantity);
            if ("error" in checked) return setResult({ error: checked.error });
            try {
              await save.mutateAsync(checked.input);
              setResult({ ok: "Existencias actualizadas." });
            } catch (error) {
              setResult({ error: messageOf(error) });
            }
          }}
        >
          Guardar
        </Button>
      </View>
      <FormMessage {...result} testID={`stock-result-${id}`} />
    </Stack>
  );
}
