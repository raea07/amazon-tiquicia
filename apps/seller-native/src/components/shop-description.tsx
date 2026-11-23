import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { Button, FormMessage, Stack, TextField } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { checkShopDescription, descriptionSent, SHOP_DESCRIPTION_MAX } from "@/lib/seller-listings";
import { shopKey, useShop } from "@/lib/shops";

/**
 * Asks staff to change the shop's public description, or to remove it: the
 * field may be left empty, and "Quitar la descripción" sends an empty one.
 * Until staff decide, the shop shows what it had. The seller centre's
 * `ShopDescriptionForm`.
 */
export function ShopDescriptionForm({
  current,
  hasDescription,
  onSent,
}: {
  /** What the field starts from: a proposal waiting or refused, else the description. */
  current: string;
  /** The shop shows a description now, so it can be removed. */
  hasDescription: boolean;
  /**
   * What to tell the seller once it is sent. Shown by the card, not here: the
   * request it creates starts this form afresh.
   */
  onSent: (message: string) => void;
}) {
  const shop = useShop();
  const [text, setText] = useState(current);
  const [sending, setSending] = useState<"send" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useApiMutation(
    (api, description: string) => api.sellerRequestShopDescription(shop.id, description),
    { invalidates: [shopKey(shop.id, "front")] },
  );

  async function send(removing: boolean) {
    const checked = checkShopDescription(text, removing);
    if ("error" in checked) return setError(checked.error);
    setError(null);
    setSending(removing ? "remove" : "send");
    try {
      await request.mutateAsync(checked.input);
      onSent(descriptionSent(checked.input));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSending(null);
    }
  }

  return (
    <Stack gap={3}>
      <TextField
        label="Descripción de la tienda"
        optional
        multiline
        value={text}
        onChangeText={setText}
        maxLength={SHOP_DESCRIPTION_MAX * 2}
        hint={`Hasta ${SHOP_DESCRIPTION_MAX} caracteres. Qué vende, de dónde y lo que lo distingue. Se muestra como texto, tal cual lo escribe. Déjela vacía para quitarla.`}
        testID="shop-description"
      />
      <FormMessage error={error} testID="shop-description-error" />
      <Button
        loading={sending === "send"}
        disabled={sending !== null}
        loadingLabel="Enviando…"
        onPress={() => void send(false)}
        testID="shop-description-submit"
      >
        Enviar a revisión
      </Button>
      {hasDescription ? (
        <Button
          variant="secondary"
          loading={sending === "remove"}
          disabled={sending !== null}
          loadingLabel="Enviando…"
          onPress={() => void send(true)}
          testID="shop-description-remove"
        >
          Quitar la descripción
        </Button>
      ) : null}
    </Stack>
  );
}
