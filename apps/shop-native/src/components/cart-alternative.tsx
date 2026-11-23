import type { CartLine, DatedCartAlternative } from "@yuntera/db";
import { tone } from "@yuntera/expo-kit/theme";
import { Alert, Button, formatDate, Stack, Text, TextLink } from "@yuntera/expo-kit/ui";
import { useCart } from "@/lib/cart-context";
import { type AlternativesLookup, arrivalText, unavailableNote } from "@/lib/cart-wording";
import { TRY_AGAIN } from "@/lib/kept-reads";

const warningText = { color: tone.warning.fg };

/**
 * When the other shop's offer would arrive in the cart's district: the date
 * the database gives with the alternative (cart_alternatives, 084600), the
 * one that offer's product page gives at the same moment. Nothing when the
 * district is not served (the summary says so).
 */
function AlternativeArrival({ alternative }: { alternative: DatedCartAlternative }) {
  if (!alternative.promise) return null;
  return (
    <Text variant="smallStrong" style={warningText} testID="cart-alternative-arrival">
      {arrivalText(alternative.promise, (value) => formatDate(value))}
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
  lookup = "done",
  onRetry,
}: {
  line: CartLine;
  alternative: DatedCartAlternative | undefined;
  quantity: number;
  /** Whether the other shops were checked (see cart-wording.ts). */
  lookup?: AlternativesLookup;
  /** Asks for the other shops again, when they could not be checked. */
  onRetry?: () => void;
}) {
  const cart = useCart();
  const note = unavailableNote(line, alternative ?? null, quantity, alternative ? "done" : lookup);
  if (!alternative || !note.swapLabel) {
    return (
      <Alert tone="warning" title={note.title} testID="cart-unavailable">
        {lookup === "failed" && onRetry ? (
          <Stack gap={2}>
            <Text variant="small" style={warningText}>
              {note.body}
            </Text>
            <Button variant="secondary" onPress={onRetry} testID="cart-alternatives-retry">
              {TRY_AGAIN}
            </Button>
          </Stack>
        ) : (
          note.body
        )}
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
