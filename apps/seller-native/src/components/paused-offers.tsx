import type { PausedOffer } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import {
  Button,
  FormMessage,
  formatDate,
  formatPrice,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { withPriceFloor } from "@/lib/refusal";
import { plainColones } from "@/lib/rules";
import { checkResumePrice, pausedHeading, pausedReason, RESUMED } from "@/lib/seller-listings";
import { shopKey, useShop } from "@/lib/shops";

const dayMonth = (value: string) => formatDate(value, { day: "numeric", month: "long" });

/** A new price and the offer back on sale, in one step (the seller centre's `ResumeOfferForm`). */
function ResumeForm({ offer, label }: { offer: PausedOffer; label: string }) {
  const shop = useShop();
  const [price, setPrice] = useState(
    offer.min_price_minor ? plainColones(offer.min_price_minor) : "",
  );
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const resume = useApiMutation(
    (api, input: { priceMinor: number; listPriceMinor: number | null }) =>
      api.sellerUpdateOffer({
        offerId: offer.offer_id,
        priceMinor: input.priceMinor,
        listPriceMinor: input.listPriceMinor,
        status: "active",
      }),
    { invalidates: [shopKey(shop.id, "listings")] },
  );
  // Shown in place of the form; the list drops the offer the next time it is read.
  if (result.ok) return <FormMessage ok={result.ok} testID="paused-offer-result" />;
  return (
    <Stack gap={2}>
      <TextField
        label="Precio nuevo (₡, IVA incluido)"
        value={price}
        onChangeText={setPrice}
        inputMode="decimal"
        keyboardType="decimal-pad"
        accessibilityHint={label}
        testID={`paused-price-${offer.offer_id}`}
      />
      <FormMessage error={result.error} testID="paused-offer-result" />
      <Button
        loading={resume.isPending}
        loadingLabel="Guardando…"
        aria-label={`Guardar el precio y poner a la venta: ${label}`}
        testID={`paused-resume-${offer.offer_id}`}
        onPress={async () => {
          const checked = checkResumePrice(price, offer.list_price_minor);
          if ("error" in checked) return setResult({ error: checked.error });
          setResult({});
          try {
            await resume.mutateAsync(checked.input);
            setResult({ ok: RESUMED });
          } catch (error) {
            setResult({ error: withPriceFloor(error, messageOf(error)) });
          }
        }}
      >
        Guardar el precio y poner a la venta
      </Button>
    </Stack>
  );
}

/**
 * Offers paused because their price no longer covers the fees (a fee change,
 * or an approved edit of the listing's package or category): why, the lowest
 * price that does, and the way back on sale. Nothing when there are none.
 * The seller centre's `PausedOffers`, at the top of its products page.
 */
export function PausedOffers() {
  const shop = useShop();
  const paused = useApiQuery(
    shopKey(shop.id, "paused-offers"),
    (api) => api.sellerPausedOffers(shop.id),
    { personal: true },
  );
  // A list that could not be read is not a reason to hide the products under it.
  const offers = paused.data ?? [];
  if (offers.length === 0) return null;
  return (
    <View style={styles.box} testID="paused-offers">
      <Text variant="heading">{pausedHeading(offers.length)}</Text>
      <Text variant="small" tint="muted">
        Para venderla otra vez, ponga un precio que cubra las tarifas y guárdelo: vuelve a la venta
        en el mismo paso.
      </Text>
      {offers.map((offer) => {
        const label = `${offer.title}${offer.variant_name ? `, ${offer.variant_name}` : ""}`;
        return (
          <View key={offer.offer_id} style={styles.item} testID={`paused-offer-${offer.offer_id}`}>
            <Text variant="bodyStrong">{label}</Text>
            <Text variant="caption" tint="muted">
              {`${offer.sku_code} · precio en pausa ${formatPrice(offer.price_minor)}`}
            </Text>
            <Text variant="small">{pausedReason(offer, dayMonth)}</Text>
            {offer.min_price_minor ? (
              <>
                <Text variant="smallStrong">
                  {`El precio más bajo que cubre las tarifas es ${formatPrice(offer.min_price_minor)}.`}
                </Text>
                <ResumeForm offer={offer} label={label} />
              </>
            ) : (
              <Text variant="smallStrong">
                Con las tarifas actuales ningún precio cubre el costo de venderlo así. Escríbanos y
                lo revisamos con usted.
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
  },
  item: { gap: space[1], borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[3] },
});
