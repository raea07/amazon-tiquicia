import type { ProductOffer, ProductPage } from "@yuntera/db";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import { colors, radius, space, touchTarget } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatDate,
  formatPrice,
  LinkButton,
  LoadingState,
  Money,
  Screen,
  SectionHeader,
  Stack,
  Text,
  TextLink,
} from "@yuntera/expo-kit/ui";
import { Link, Stack as Nav, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ProductGrid, ProductImage, Stars } from "@/components/product";
import { QuantityStepper } from "@/components/quantity";
import { useCart } from "@/lib/cart-context";
import { chooseSku, rankOffers } from "@/lib/offers";

/** Who sells it, who delivers it, and when it arrives: the facts the law wants in plain sight. */
function OfferFacts({ offer }: { offer: ProductOffer }) {
  return (
    <View style={styles.facts}>
      <Text variant="small">
        <Text variant="small" tint="muted">
          Vendido por{" "}
        </Text>
        <Text variant="smallStrong">{offer.seller.trade_name}</Text>
      </Text>
      <Text variant="small">
        <Text variant="small" tint="muted">
          Entrega{" "}
        </Text>
        {offer.fulfillment === "platform"
          ? "Sale de la bodega de Yuntera"
          : "El vendedor lo despacha y Yuntera lo entrega"}
      </Text>
      {offer.promise ? (
        <Text variant="small">
          <Text variant="small" tint="muted">
            Llega{" "}
          </Text>
          <Text variant="smallStrong" tint="success">
            {offer.promise.earliest === offer.promise.latest
              ? `el ${formatDate(offer.promise.latest)}`
              : `entre el ${formatDate(offer.promise.earliest)} y el ${formatDate(offer.promise.latest)}`}
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

/** Quantity and the two purchase buttons for one offer. */
function AddToCart({ offer, compact = false }: { offer: ProductOffer; compact?: boolean }) {
  const cart = useCart();
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const max = Math.min(offer.available, 10);

  function add(buyNow: boolean) {
    const error = cart.add(offer.offer_id, quantity);
    if (error) {
      setMessage({ error });
      return;
    }
    if (buyNow) router.push("/pagar");
    else setMessage({ ok: "Agregado al carrito." });
  }

  return (
    <Stack gap={3}>
      <View style={styles.quantityRow}>
        <Text variant="smallStrong">Cantidad</Text>
        <QuantityStepper
          value={quantity}
          max={max}
          onChange={setQuantity}
          testID={`quantity-${offer.offer_id}`}
        />
      </View>
      <Button block size={compact ? "md" : "lg"} onPress={() => add(false)} testID="add-to-cart">
        Agregar al carrito
      </Button>
      {compact ? null : (
        <Button block variant="secondary" onPress={() => add(true)} testID="buy-now">
          Comprar ahora
        </Button>
      )}
      {message.error ? <Alert tone="danger">{message.error}</Alert> : null}
      {message.ok ? (
        <Alert tone="success" testID="added-message">
          <View style={styles.added}>
            <Text variant="small" style={{ color: colors.palette.selva[900] }}>
              {message.ok}
            </Text>
            <Link href="/carrito" style={styles.addedLink}>
              <Text variant="smallStrong" tint="link">
                Ver carrito
              </Text>
            </Link>
          </View>
        </Alert>
      ) : null}
    </Stack>
  );
}

function BuyBox({
  product,
  featured,
  chosenLocation,
}: {
  product: ProductPage;
  featured: ProductOffer | undefined;
  chosenLocation: boolean;
}) {
  const zone = product.zone;
  return (
    <Card testID="buy-box">
      {featured ? (
        <>
          <View>
            <Money
              amountMinor={featured.price_minor}
              listAmountMinor={featured.list_price_minor}
              size="lg"
            />
            <Text variant="caption" tint="muted">
              Precio final, IVA incluido.
            </Text>
          </View>
          <OfferFacts offer={featured} />
          {zone && !zone.active ? (
            <Alert tone="warning" title="Por ahora no entregamos en su zona">
              <Text variant="small" style={{ color: colors.palette.maiz[900] }}>
                Puede comprar para una dirección en otra zona.
              </Text>
              <TextLink href="/zona">Cambiar de zona</TextLink>
            </Alert>
          ) : (
            <>
              {zone ? (
                <Text variant="small" tint="muted">
                  {zone.free_shipping_threshold_minor
                    ? `Envío ${formatPrice(zone.shipping_fee_minor)}; gratis en pedidos desde ${formatPrice(zone.free_shipping_threshold_minor)}.`
                    : `Envío ${formatPrice(zone.shipping_fee_minor)}.`}
                </Text>
              ) : null}
              {chosenLocation ? null : (
                <TextLink href="/zona">Elija su zona para confirmar la fecha</TextLink>
              )}
            </>
          )}
          {featured.available > 0 ? (
            <>
              {featured.available <= 3 ? (
                <Text variant="smallStrong" tint="warning">
                  {featured.available === 1
                    ? "Queda 1 unidad"
                    : `Quedan ${featured.available} unidades`}
                </Text>
              ) : null}
              <AddToCart offer={featured} />
            </>
          ) : (
            <Alert tone="warning">Agotado por ahora.</Alert>
          )}
        </>
      ) : (
        <Alert tone="warning" title="No disponible por ahora">
          Ningún vendedor tiene este producto en este momento.
        </Alert>
      )}
      <View style={styles.rights}>
        <Text variant="small" tint="muted">
          <Text variant="smallStrong">Devolución: </Text>8 días hábiles desde que lo recibe, sin dar
          explicaciones.
        </Text>
        <Text variant="small" tint="muted">
          <Text variant="smallStrong">Garantía: </Text>
          {product.warranty_months > 1
            ? `${product.warranty_months} meses con el vendedor.`
            : "30 días hábiles por ley."}
        </Text>
        <Text variant="small" tint="muted">
          <Text variant="smallStrong">Pago: </Text>SINPE Móvil, tarjeta o contra entrega.
        </Text>
      </View>
    </Card>
  );
}

function Reviews({ product }: { product: ProductPage }) {
  const total = product.rating_count;
  return (
    <Stack gap={3}>
      <SectionHeader title="Reseñas de quienes lo compraron" />
      {total === 0 ? (
        <Text tint="muted">
          Todavía no tiene reseñas. Solo puede reseñar quien compró y recibió el producto.
        </Text>
      ) : (
        <>
          <Stars ratingSum={product.rating_sum} ratingCount={product.rating_count} />
          <View style={styles.histogram}>
            {[5, 4, 3, 2, 1].map((stars) => {
              const count = product.rating_histogram[String(stars)] ?? 0;
              const percent = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <View
                  key={stars}
                  style={styles.bar}
                  aria-label={`${stars} ${stars === 1 ? "estrella" : "estrellas"}: ${count}`}
                >
                  <Text variant="small" tint="muted" style={styles.barLabel}>
                    {stars} {stars === 1 ? "estrella" : "estrellas"}
                  </Text>
                  <View style={styles.track} aria-hidden>
                    <View style={[styles.fill, { width: `${percent}%` }]} />
                  </View>
                  <Text variant="small" style={styles.barCount}>
                    {count}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text variant="caption" tint="muted">
            Publicamos todas las reseñas de compras verificadas, buenas y malas.
          </Text>
          {product.reviews.map((review) => (
            <View key={review.id} style={styles.review}>
              <View style={styles.reviewHead}>
                <Stars ratingSum={review.rating} ratingCount={1} showCount={false} />
                <Text variant="smallStrong">{review.author}</Text>
                <Text variant="small" tint="muted">
                  {formatDate(review.created_at, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </Text>
              </View>
              {review.title ? <Text variant="bodyStrong">{review.title}</Text> : null}
              {review.body ? <Text>{review.body}</Text> : null}
              {review.seller_reply ? (
                <View style={styles.reply}>
                  <Text variant="small">
                    <Text variant="smallStrong">Respuesta del vendedor: </Text>
                    {review.seller_reply}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}
        </>
      )}
    </Stack>
  );
}

/** A product, at /p/<slug> like the website: competing offers and the delivery date for the chosen district. */
export default function ProductScreen() {
  const params = useLocalSearchParams<{ slug: string; v?: string }>();
  const slug = oneParam(params.slug) ?? "";
  const { postalCode, locationChosen } = useCart();
  const [variant, setVariant] = useState(oneParam(params.v));
  const product = useApiQuery(["product", slug, postalCode], (api) =>
    api.getProduct(slug, postalCode),
  );

  if (product.isPending) return <LoadingState label="Cargando producto…" />;
  if (product.isError)
    return <ErrorState error={product.error} onRetry={() => void product.refetch()} />;
  if (!product.data) {
    return (
      <EmptyState
        title="No encontramos ese producto"
        action={<LinkButton href="/buscar">Ver productos</LinkButton>}
      >
        Puede que el enlace esté mal escrito o que el producto ya no esté a la venta.
      </EmptyState>
    );
  }

  const page = product.data;
  const sku = chooseSku(page, variant);
  const { featured, others } = rankOffers(sku?.offers ?? []);

  return (
    <Screen refreshing={product.isRefetching} onRefresh={() => void product.refetch()}>
      <Nav.Screen options={{ title: page.category.name_es }} />
      <View style={styles.imageFrame}>
        <ProductImage
          path={page.images[0]?.path ?? null}
          label={page.images[0]?.alt || page.title}
        />
      </View>

      <Stack gap={2}>
        {page.brand ? (
          <Text variant="caption" tint="muted">
            {page.brand.toUpperCase()}
          </Text>
        ) : null}
        <Text variant="title" testID="product-title">
          {page.title}
        </Text>
        <Stars ratingSum={page.rating_sum} ratingCount={page.rating_count} />
        {page.made_in_cr ? <Badge tone="success">Hecho en Costa Rica</Badge> : null}
      </Stack>

      {page.skus.length > 1 ? (
        <Stack gap={2}>
          <Text variant="smallStrong">Opciones</Text>
          <View role="radiogroup" aria-label="Opciones" style={styles.options}>
            {page.skus.map((option) => {
              const selected = option.id === sku?.id;
              const inStock = option.offers.some((o) => o.available > 0);
              return (
                <Pressable
                  key={option.id}
                  role="radio"
                  aria-checked={selected}
                  onPress={() => setVariant(option.code)}
                  style={[styles.option, selected ? styles.optionOn : null]}
                >
                  <Text
                    variant={selected ? "smallStrong" : "small"}
                    tint={inStock ? "ink" : "muted"}
                    style={inStock ? null : { textDecorationLine: "line-through" }}
                  >
                    {inStock ? option.variant_name : `${option.variant_name} (agotado)`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Stack>
      ) : null}

      <BuyBox product={page} featured={featured} chosenLocation={locationChosen} />

      {page.bullet_points.length > 0 || page.description ? (
        <Stack gap={2}>
          {page.bullet_points.map((point) => (
            <Text key={point}>{`•  ${point}`}</Text>
          ))}
          {page.description ? <Text tint="muted">{page.description}</Text> : null}
        </Stack>
      ) : null}

      {others.length > 0 ? (
        <Stack gap={3}>
          <SectionHeader title="Otras ofertas de este producto" />
          <Text variant="small" tint="muted">
            Mostramos primero la oferta nueva con existencias y el precio más bajo; si cuestan lo
            mismo, la que se publicó antes. Puede comprar cualquiera de estas.
          </Text>
          <TextLink href="/ayuda">Cómo las ordenamos</TextLink>
          {others.map((offer) => (
            <Card key={offer.offer_id} testID="other-offer">
              <Money amountMinor={offer.price_minor} listAmountMinor={offer.list_price_minor} />
              <OfferFacts offer={offer} />
              {offer.available > 0 ? (
                <AddToCart offer={offer} compact />
              ) : (
                <Badge tone="warning">Agotado</Badge>
              )}
            </Card>
          ))}
        </Stack>
      ) : null}

      <Reviews product={page} />

      {/* As on the website's product page: anyone can report a listing. */}
      <TextLink
        href={{ pathname: "/reportar", params: { producto: page.id } }}
        testID="report-listing"
      >
        Reportar un problema
      </TextLink>

      {page.related.length > 0 ? (
        <Stack gap={3}>
          <SectionHeader
            title={
              page.related.some((r) => r.kind === "bought_together")
                ? "Quienes compraron esto también llevaron"
                : "Productos parecidos"
            }
          />
          <ProductGrid products={page.related.slice(0, 4)} testIDPrefix="related-product" />
        </Stack>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  imageFrame: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  facts: { gap: 4 },
  quantityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  added: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  addedLink: { minHeight: touchTarget, paddingVertical: space[3], paddingHorizontal: space[1] },
  rights: { gap: space[2], borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space[3] },
  options: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  option: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.fieldBorder,
    backgroundColor: colors.surface,
  },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
  histogram: { gap: space[1] + 2 },
  bar: { flexDirection: "row", alignItems: "center", gap: space[2] },
  barLabel: { width: 84 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.palette.arena[200],
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: colors.rating },
  barCount: { width: 24, textAlign: "right", fontVariant: ["tabular-nums"] },
  review: {
    gap: space[1],
    paddingBottom: space[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  reply: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: space[3],
    marginTop: space[2],
  },
});
