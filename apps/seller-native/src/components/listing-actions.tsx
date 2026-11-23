import type { SellerListingVariant, SharedListingDetail } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { colors, space } from "@yuntera/expo-kit/theme";
import { Badge, Button, Card, Checkbox, FormMessage, Stack, Text } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { View } from "react-native";
import {
  bringsBack,
  pausedElsewhere,
  sharedBy,
  UNPUBLISH_CONFIRM_NEEDED,
  VARIANT_DONE,
} from "@/lib/seller-listings";
import { shopKey, useShop } from "@/lib/shops";

/** One variant: on sale, retired or its own offer paused, with the button that switches it. */
function VariantRow({
  variant,
  archived,
  index,
}: {
  variant: SellerListingVariant;
  archived: boolean;
  index: number;
}) {
  const shop = useShop();
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const name = variant.variant_name || variant.sku_code;
  const ownPaused = variant.own_offer_status === "paused";
  const back = bringsBack(variant);
  const toggle = useApiMutation(
    (api, active: boolean) => api.sellerSetVariantActive(variant.sku_id, active),
    { invalidates: [shopKey(shop.id)] },
  );
  return (
    <View
      style={{
        gap: space[2],
        paddingVertical: space[3],
        borderTopWidth: index > 0 ? 1 : 0,
        borderTopColor: colors.border,
      }}
      testID={`variant-${variant.sku_code}`}
    >
      <Text variant="bodyStrong">{name}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
        {!variant.active ? (
          <Badge tone="neutral">Retirada</Badge>
        ) : ownPaused ? (
          // Whether or not another shop sells it: this shop does not, now.
          <Badge tone="warning">Su oferta en pausa</Badge>
        ) : (
          <Badge tone="success">A la venta</Badge>
        )}
        {variant.shared ? <Badge tone="info">Otra tienda también la vende</Badge> : null}
      </View>
      {archived ? null : (
        <Button
          variant="secondary"
          loading={toggle.isPending}
          loadingLabel={back ? "Volviendo a ofrecer…" : "Retirando…"}
          aria-label={`${back ? "Volver a ofrecer" : "Retirar"} la variante ${name}`}
          testID={`variant-${variant.sku_code}-toggle`}
          onPress={async () => {
            setResult({});
            try {
              const changed = await toggle.mutateAsync(back);
              setResult({ ok: VARIANT_DONE[changed.outcome] });
            } catch (error) {
              setResult({ error: messageOf(error) });
            }
          }}
        >
          {back ? "Volver a ofrecer" : "Retirar"}
        </Button>
      )}
      <FormMessage {...result} testID={`variant-${variant.sku_code}-result`} />
    </View>
  );
}

/**
 * Each variant, on sale or retired, with the button that switches it. A
 * variant another shop also sells stays in the shop for that shop: retiring
 * it pauses only this shop's own offer. The seller centre's `Variants`.
 */
export function VariantsCard({ listing }: { listing: SharedListingDetail }) {
  return (
    <Card testID="variants">
      <Text variant="heading">Variantes a la venta</Text>
      <Text variant="small" tint="muted">
        Retire una variante que ya no tiene o no quiere vender: nadie la puede pedir hasta que la
        vuelva a ofrecer. Los pedidos que ya tiene y sus existencias no cambian.
      </Text>
      <View>
        {listing.variants.map((variant, index) => (
          <VariantRow
            key={variant.sku_id}
            variant={variant}
            archived={listing.status === "archived"}
            index={index}
          />
        ))}
      </View>
    </Card>
  );
}

/**
 * Takes a published listing back to draft: out of the shop and of search,
 * nobody can buy it, its orders go on. Not possible while another shop sells
 * on it (the card says why). The tick box makes it deliberate. The seller
 * centre's "Volver a borrador".
 */
export function UnpublishCard({
  listing,
  onDone,
}: {
  listing: SharedListingDetail;
  /** Called with whether a change waiting for review was withdrawn with it. */
  onDone: (editWithdrawn: boolean) => void;
}) {
  const shop = useShop();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unpublish = useApiMutation((api) => api.sellerUnpublishListing(listing.product_id), {
    invalidates: [shopKey(shop.id)],
  });
  const paused = pausedElsewhere(listing.paused_other_shops);
  return (
    <Card testID="unpublish">
      <Text variant="heading">Volver a borrador</Text>
      {listing.shared ? (
        <Text variant="small" tint="muted">
          {`${sharedBy(listing.other_shops)}, así que no puede salir de la tienda. Cambie lo que necesite con «Enviar cambios a revisión»: mientras tanto sigue a la venta como está.`}
        </Text>
      ) : (
        <Stack gap={3}>
          <Text variant="small" tint="muted">
            {`Para rehacerlo con calma: deja de aparecer en la tienda y en las búsquedas, y nadie lo puede comprar. Los pedidos que ya tiene siguen su curso. Cuando lo envíe a revisión y lo aprobemos, vuelve a la venta.${paused ? `\n${paused}` : ""}`}
          </Text>
          <Checkbox checked={confirmed} onChange={setConfirmed} testID="unpublish-confirm">
            <Text variant="small">
              Entiendo que deja de aparecer en la tienda y de venderse hasta que lo aprueben de
              nuevo.
            </Text>
          </Checkbox>
          <FormMessage error={error} testID="unpublish-error" />
          <Button
            variant="secondary"
            loading={unpublish.isPending}
            loadingLabel="Volviendo a borrador…"
            testID="unpublish-submit"
            onPress={async () => {
              if (!confirmed) return setError(UNPUBLISH_CONFIRM_NEEDED);
              setError(null);
              try {
                const done = await unpublish.mutateAsync(undefined);
                onDone(done.edit_withdrawn);
              } catch (cause) {
                setError(messageOf(cause));
              }
            }}
          >
            Volver a borrador
          </Button>
        </Stack>
      )}
    </Card>
  );
}
