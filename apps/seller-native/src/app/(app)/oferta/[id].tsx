import type { SellerListing } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import { space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  ChoiceList,
  EmptyState,
  ErrorState,
  FormMessage,
  InfoRow,
  LinkButton,
  LoadingState,
  Screen,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ProductThumb } from "@/components/parts";
import { StockForm } from "@/components/stock-form";
import { WithdrawOfferCard } from "@/components/withdraw-offer";
import { FULFILLMENT_LABEL, PRODUCT_STATUS } from "@/lib/labels";
import { withPriceFloor } from "@/lib/refusal";
import { checkOffer, type OfferInput, plainColones } from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

type Result = { ok?: string; error?: string };

/** Price, regular price, on sale or paused, and handling time: no review needed. */
function PriceForm({ listing }: { listing: SellerListing }) {
  const shop = useShop();
  const [price, setPrice] = useState(plainColones(listing.price_minor));
  const [listPrice, setListPrice] = useState(
    listing.list_price_minor ? plainColones(listing.list_price_minor) : "",
  );
  const [status, setStatus] = useState<"active" | "paused">(
    listing.offer_status === "paused" ? "paused" : "active",
  );
  const [handlingDays, setHandlingDays] = useState(String(listing.handling_days));
  const [result, setResult] = useState<Result>({});
  const save = useApiMutation(
    (api, input: OfferInput) => api.sellerUpdateOffer({ offerId: listing.offer_id, ...input }),
    { invalidates: [shopKey(shop.id)] },
  );

  return (
    <Card>
      <Text variant="heading">Precio y venta</Text>
      <TextField
        label="Precio (₡, IVA incluido)"
        value={price}
        onChangeText={setPrice}
        inputMode="decimal"
        keyboardType="decimal-pad"
        testID="offer-price"
      />
      <TextField
        label="Precio regular"
        optional
        value={listPrice}
        onChangeText={setListPrice}
        inputMode="decimal"
        keyboardType="decimal-pad"
        hint="Solo si hay una rebaja real."
        testID="offer-list-price"
      />
      <Text variant="smallStrong">Venta</Text>
      <ChoiceList
        label="Venta"
        value={status}
        onChange={setStatus}
        testID="offer-status"
        choices={[
          { value: "active", title: "A la venta" },
          { value: "paused", title: "En pausa", description: "No se ofrece hasta que la reanude." },
        ]}
      />
      {listing.fulfillment === "seller" ? (
        <TextField
          label="Días para alistarlo"
          value={handlingDays}
          onChangeText={setHandlingDays}
          keyboardType="number-pad"
          inputMode="numeric"
        />
      ) : null}
      <FormMessage {...result} testID="offer-result" />
      <Button
        loading={save.isPending}
        loadingLabel="Guardando…"
        testID="offer-save"
        onPress={async () => {
          const checked = checkOffer({
            price,
            listPrice,
            status,
            handlingDays: listing.fulfillment === "seller" ? handlingDays : "",
          });
          if ("error" in checked) return setResult({ error: checked.error });
          try {
            await save.mutateAsync(checked.input);
            setResult({ ok: "Cambios guardados." });
          } catch (error) {
            setResult({ error: withPriceFloor(error, messageOf(error)) });
          }
        }}
      >
        Guardar precio
      </Button>
    </Card>
  );
}

/** One offer: its state, its price and its stock, and the way to edit the listing. */
export default function OfferScreen() {
  const shop = useShop();
  const offerId = oneParam(useLocalSearchParams<{ id: string }>().id) ?? "";
  const listings = useApiQuery(shopKey(shop.id, "listings"), (api) => api.sellerListings(shop.id), {
    personal: true,
  });
  const edits = useApiQuery(
    shopKey(shop.id, "listing-edits"),
    (api) => api.sellerListingEdits(shop.id),
    { personal: true },
  );
  const stock = useApiQuery(shopKey(shop.id, "stock"), (api) => api.sellerStock(shop.id), {
    personal: true,
  });
  const locations = useApiQuery(
    shopKey(shop.id, "locations"),
    (api) => api.sellerLocations(shop.id),
    { personal: true },
  );

  const queries = [listings, edits, stock, locations];
  const failed = queries.find((query) => query.isError);
  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  if (!listings.data || !edits.data || !stock.data || !locations.data) return <LoadingState />;

  const listing = listings.data.find((row) => row.offer_id === offerId);
  if (!listing) {
    return (
      <EmptyState
        title="No encontramos ese producto"
        action={<LinkButton href="/productos">Ver sus productos</LinkButton>}
      >
        No está entre los de esta tienda. Si trabaja en varias, revise en cuál está.
      </EmptyState>
    );
  }
  const status = PRODUCT_STATUS[listing.product_status];
  const edit = edits.data.find((row) => row.product_id === listing.product_id);
  const levelAt = (warehouseId: string) =>
    stock.data.find((row) => row.warehouse_id === warehouseId && row.sku_id === listing.sku_id);
  const hosted = stock.data.filter(
    (row) => row.warehouse_kind === "platform" && row.sku_id === listing.sku_id,
  );

  return (
    <Screen
      refreshing={listings.isRefetching}
      onRefresh={() => queries.forEach((query) => void query.refetch())}
    >
      <View style={{ flexDirection: "row", gap: space[3] }}>
        <ProductThumb path={listing.image_path} size={72} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="heading" testID="offer-title">
            {listing.title}
          </Text>
          <Text variant="caption" tint="muted">
            {listing.sku_code}
            {listing.variant_name ? ` · ${listing.variant_name}` : ""}
          </Text>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}
            testID="offer-badges"
          >
            <Badge tone={status.tone}>{status.label}</Badge>
            {edit?.edit_status === "pending" ? (
              <Badge tone="warning">Cambios en revisión</Badge>
            ) : null}
          </View>
        </View>
      </View>
      <Text variant="small" tint="muted">
        {FULFILLMENT_LABEL[listing.fulfillment]}
      </Text>
      {listing.rejection_reason ? (
        <Alert
          tone="danger"
          title="No lo publicamos"
        >{`Motivo: ${listing.rejection_reason}`}</Alert>
      ) : null}
      {edit?.edit_status === "rejected" && edit.edit_reason ? (
        <Alert tone="danger" title="No aprobamos su último cambio">
          {`Motivo: ${edit.edit_reason}`}
        </Alert>
      ) : null}
      {listing.product_status === "active" && listing.is_featured !== null ? (
        <Text variant="small">
          {listing.is_featured ? "Su oferta es la destacada." : "Su oferta no es la destacada."}
          {listing.competing_offers > 0
            ? listing.competing_offers === 1
              ? " Otro vendedor ofrece este producto."
              : ` ${listing.competing_offers} vendedores más lo ofrecen.`
            : ""}
        </Text>
      ) : null}

      {edit && !edit.editable && listing.product_status !== "archived" ? (
        <Alert tone="info" title="Publicación de otra tienda" testID="shared-listing">
          Usted vende en esta publicación, que creó otra tienda: aquí cambia su precio, si está a la
          venta y sus existencias. El título, las fotos y la descripción los cambia esa tienda.
        </Alert>
      ) : null}

      <PriceForm key={listing.offer_id} listing={listing} />

      <Card>
        <Text variant="heading">Existencias</Text>
        <InfoRow
          label="Disponibles para vender"
          value={String(listing.available_quantity)}
          strong
        />
        {listing.fulfillment === "seller" ? (
          locations.data.own.length === 0 ? (
            <>
              <Alert tone="warning" title="Falta registrar de dónde recogemos sus paquetes">
                Sin ese lugar no podemos ofrecer este producto: no sabríamos adónde enviar al
                repartidor.
              </Alert>
              <LinkButton href="/lugar" variant="secondary" block>
                Registrar el lugar de recolección
              </LinkButton>
            </>
          ) : (
            locations.data.own.map((location) => {
              const level = levelAt(location.id);
              return (
                <StockForm
                  key={location.id}
                  warehouseId={location.id}
                  skuId={listing.sku_id}
                  place={location.name}
                  onHand={level?.on_hand ?? 0}
                  reserved={level?.reserved ?? 0}
                />
              );
            })
          )
        ) : (
          <>
            <Text variant="small" tint="muted">
              Estas existencias las cuenta la bodega al recibir su mercadería; usted no las edita.
            </Text>
            {hosted.length === 0 ? (
              <Text variant="small">Todavía no hay unidades de este producto en bodega.</Text>
            ) : (
              hosted.map((row) => (
                <InfoRow
                  key={row.warehouse_id}
                  label={`${row.warehouse_name}: ${row.on_hand} en bodega, ${row.reserved} apartadas`}
                  value={`${row.available} disp.`}
                />
              ))
            )}
            <LinkButton href="/envio" variant="secondary" block>
              Enviar mercadería a la bodega
            </LinkButton>
          </>
        )}
      </Card>

      {edit && !edit.editable && listing.product_status !== "archived" ? (
        <WithdrawOfferCard
          offerId={listing.offer_id}
          priceMinor={listing.price_minor}
          label={`${listing.title}${listing.variant_name ? `, ${listing.variant_name}` : ""}`}
        />
      ) : null}

      {edit?.editable ? (
        <Card>
          <Text variant="heading">La publicación</Text>
          <Text variant="small" tint="muted">
            {listing.product_status === "active"
              ? "El título, la descripción, la categoría y el paquete se cambian aparte: los revisamos antes de mostrarlos, y mientras tanto su publicación sigue igual."
              : "Mientras no esté publicado puede cambiarlo las veces que quiera."}
          </Text>
          <LinkButton
            href={{
              pathname: "/editar/[id]",
              params: { id: listing.product_id, v: listing.sku_id },
            }}
            variant="secondary"
            block
            testID="edit-listing"
          >
            Editar título, descripción y paquete
          </LinkButton>
        </Card>
      ) : null}
    </Screen>
  );
}
