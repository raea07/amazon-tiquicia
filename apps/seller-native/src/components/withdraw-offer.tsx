import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useInvalidate } from "@yuntera/expo-kit/data";
import { Button, Card, Checkbox, FormMessage, Text } from "@yuntera/expo-kit/ui";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { WITHDRAW_CONFIRM_NEEDED, WITHDRAWN } from "@/lib/seller-listings";
import { shopKey, useShop } from "@/lib/shops";

/**
 * The shop stops selling a product another shop created, for good: its offer
 * is archived and leaves the product page. It can offer it again later from
 * "Vender uno que ya existe". The tick box makes it deliberate. The seller
 * centre's `WithdrawOfferForm`.
 */
export function WithdrawOfferCard({
  offerId,
  priceMinor,
  label,
}: {
  offerId: string;
  priceMinor: number;
  label: string;
}) {
  const shop = useShop();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const invalidate = useInvalidate();
  const withdrawn = useRef(false);
  const withdraw = useApiMutation(
    (api) => api.sellerUpdateOffer({ offerId, priceMinor, status: "archived" }),
    // The shop's lists are read again when this screen is left (below): read
    // now, the offer would vanish from this screen and take this
    // confirmation with it.
    {
      invalidates: [shopKey(shop.id, "overview")],
      onSuccess: () => {
        withdrawn.current = true;
      },
    },
  );
  // Leaving the screen (back, or anywhere else): Productos no longer lists
  // the offer as on sale.
  useFocusEffect(
    useCallback(
      () => () => {
        if (!withdrawn.current) return;
        withdrawn.current = false;
        void invalidate([shopKey(shop.id)]);
      },
      [invalidate, shop.id],
    ),
  );
  return (
    <Card testID="withdraw-offer">
      <Text variant="heading">Dejar de venderlo</Text>
      {result.ok ? (
        <FormMessage ok={result.ok} testID="withdraw-offer-result" />
      ) : (
        <>
          <Text variant="small" tint="muted">
            Su oferta sale de la página del producto y de su lista. La publicación sigue para la
            tienda que la creó.
          </Text>
          <Checkbox checked={confirmed} onChange={setConfirmed} testID="withdraw-offer-confirm">
            <Text variant="small">Entiendo que mi oferta sale de la página del producto.</Text>
          </Checkbox>
          <FormMessage error={result.error} testID="withdraw-offer-result" />
          <Button
            variant="secondary"
            loading={withdraw.isPending}
            loadingLabel="Retirando…"
            aria-label={`Dejar de vender este producto: ${label}`}
            testID="withdraw-offer-submit"
            onPress={async () => {
              if (!confirmed) return setResult({ error: WITHDRAW_CONFIRM_NEEDED });
              setResult({});
              try {
                await withdraw.mutateAsync(undefined);
                setResult({ ok: WITHDRAWN });
              } catch (error) {
                setResult({ error: messageOf(error) });
              }
            }}
          >
            Dejar de vender este producto
          </Button>
        </>
      )}
    </Card>
  );
}
