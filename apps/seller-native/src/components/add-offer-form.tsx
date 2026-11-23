import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { Button, ChoiceList, FormMessage, Stack, Text, TextField } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { withPriceFloor } from "@/lib/refusal";
import { type AddOfferInput, checkAddOffer, offerAdded } from "@/lib/seller-listings";
import { shopKey, useShop } from "@/lib/shops";

/**
 * The shop's own offer on a variant of a product another shop created: its
 * price and how it ships. Nothing about the product itself: that is the
 * creating shop's, already reviewed. The seller centre's `AddOfferForm`.
 */
export function AddOfferForm({
  skuId,
  label,
  fitsWarehouse,
  testID,
}: {
  skuId: string;
  /** Read by screen readers so each variant's form is told apart. */
  label: string;
  fitsWarehouse: boolean;
  testID: string;
}) {
  const shop = useShop();
  const [price, setPrice] = useState("");
  const [listPrice, setListPrice] = useState("");
  // A package the warehouse cannot take leaves one choice, already made.
  const [fulfillment, setFulfillment] = useState<string>(fitsWarehouse ? "" : "seller");
  const [handlingDays, setHandlingDays] = useState("1");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const add = useApiMutation(
    (api, input: AddOfferInput) =>
      api.sellerAddOffer({
        sellerId: shop.id,
        skuId,
        priceMinor: input.priceMinor,
        listPriceMinor: input.listPriceMinor,
        fulfillment: input.fulfillment,
        handlingDays: input.handlingDays,
      }),
    // Not the search itself: its answer would redraw this variant as "already
    // offered" and take the confirmation with it (the seller centre does not
    // refresh that page either). The lists show the offer on the next visit.
    {
      invalidates: [
        shopKey(shop.id, "listings"),
        shopKey(shop.id, "listing-edits"),
        shopKey(shop.id, "stock"),
        shopKey(shop.id, "overview"),
      ],
    },
  );

  if (result.ok) return <FormMessage ok={result.ok} testID={`${testID}-result`} />;

  return (
    <Stack gap={3}>
      <TextField
        label="Su precio (₡, IVA incluido)"
        value={price}
        onChangeText={setPrice}
        inputMode="decimal"
        keyboardType="decimal-pad"
        accessibilityHint={label}
        testID={`${testID}-price`}
      />
      <TextField
        label="Precio regular"
        optional
        value={listPrice}
        onChangeText={setListPrice}
        inputMode="decimal"
        keyboardType="decimal-pad"
        hint="Solo si hay una rebaja real."
        testID={`${testID}-list-price`}
      />
      <Text variant="smallStrong">Quién lo guarda y lo despacha</Text>
      <ChoiceList
        label="Quién lo guarda y lo despacha"
        value={fulfillment}
        onChange={setFulfillment}
        testID={`${testID}-fulfillment`}
        choices={[
          {
            value: "seller",
            title: "Yo lo tengo y lo alisto",
            description: "Yuntera lo recoge y lo entrega.",
          },
          ...(fitsWarehouse
            ? [{ value: "platform", title: "Lo envío a la bodega de Yuntera" }]
            : []),
        ]}
      />
      {fulfillment === "seller" ? (
        <TextField
          label="Días hábiles para alistarlo"
          value={handlingDays}
          onChangeText={setHandlingDays}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          testID={`${testID}-days`}
        />
      ) : null}
      <FormMessage error={result.error} testID={`${testID}-result`} />
      <Button
        loading={add.isPending}
        loadingLabel="Agregando…"
        testID={`${testID}-submit`}
        aria-label={`Agregar mi oferta: ${label}`}
        onPress={async () => {
          const checked = checkAddOffer({ price, listPrice, fulfillment, handlingDays });
          if ("error" in checked) return setResult({ error: checked.error });
          setResult({});
          try {
            const added = await add.mutateAsync(checked.input);
            setResult({ ok: offerAdded(added.outcome, checked.input.fulfillment) });
          } catch (error) {
            setResult({ error: withPriceFloor(error, messageOf(error)) });
          }
        }}
      >
        Agregar mi oferta
      </Button>
    </Stack>
  );
}
