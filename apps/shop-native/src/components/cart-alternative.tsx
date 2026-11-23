import type { CartAlternative, CartLine } from "@yuntera/db";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { tone } from "@yuntera/expo-kit/theme";
import { Alert, Button, formatDate, Stack, Text, TextLink } from "@yuntera/expo-kit/ui";
import { useCart } from "@/lib/cart-context";
import { arrivalText, unavailableNote } from "@/lib/cart-wording";

const warningText = { color: tone.warning.fg };

/**
 * When the other shop's offer would arrive in the shopper's district: the
 * product page's answer for that offer (the same query as the product
 * screen, so it is often already in the cache). Nothing while it loads, and
 * nothing when the district is not served (the summary says so).
 */
function AlternativeArrival({ alternative }: { alternative: CartAlternative }) {
  const { postalCode } = useCart();
  const product = useApiQuery(["product", alternative.product_slug, postalCode], (api) =>
    api.getProduct(alternative.product_slug, postalCode),
  );
  const offer = product.data?.skus
    .flatMap((sku) => sku.offers)
    .find((candidate) => candidate.offer_id === alternative.alternative_offer_id);
  if (!offer?.promise) return null;
  return (
    <Text variant="smallStrong" style={warningText} testID="cart-alternative-arrival">
      {arrivalText(offer.promise, (value) => formatDate(value))}
    </Text>
  );
}

/**
 * A cart line the shopper cannot buy as it is. When another shop sells the
 * same variant: whose offer ran out, who else sells it, at what price and
 * when it would arrive, and a button that swaps the line in one tap (never
 * without it). Otherwise, that it is gone and what to do. The website's
 * `UnavailableLine`, in its words.
 */
export function UnavailableLine({
  line,
  alternative,
  quantity,
}: {
  line: CartLine;
  alternative: CartAlternative | undefined;
  quantity: number;
}) {
  const cart = useCart();
  const note = unavailableNote(line, alternative ?? null, quantity);
  if (!alternative || !note.swapLabel) {
    return (
      <Alert tone="warning" title={note.title} testID="cart-unavailable">
        {note.body}
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title={note.title} testID="cart-alternative">
      <Stack gap={2}>
        <Text variant="small" style={warningText}>
          {note.body}
        </Text>
        <AlternativeArrival alternative={alternative} />
        <Button
          onPress={() => cart.swap(line.offer_id, alternative.alternative_offer_id)}
          // The label names the other shop: at 320 px it must not be cut off.
          wrap
          testID="cart-swap"
        >
          {note.swapLabel}
        </Button>
        <TextLink href={{ pathname: "/p/[slug]", params: { slug: alternative.product_slug } }}>
          Ver todas las ofertas
        </TextLink>
      </Stack>
    </Alert>
  );
}
