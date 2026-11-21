import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import {
  Button,
  Card,
  ChoiceList,
  ErrorState,
  FormMessage,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { router } from "expo-router";
import { useState } from "react";
import {
  CategoryField,
  FeePreviewCard,
  PackageFields,
  useCategoryOptions,
} from "@/components/listing-fields";
import { checkNewListing, type ListingForm, type NewListingInput } from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

const EMPTY: ListingForm = {
  title: "",
  categorySlug: "",
  description: "",
  bullets: "",
  price: "",
  fulfillment: "platform",
  handlingDays: "1",
  weightGrams: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
};

/**
 * A new product, in the seller centre's four steps. The fields that decide
 * what the seller earns (price, category, who ships, weight and size) feed the
 * fee preview, so every charge and what is left show before anything is saved.
 */
export default function NewListingScreen() {
  const shop = useShop();
  const categories = useCategoryOptions();
  const [form, setForm] = useState<ListingForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<"submit" | "draft" | null>(null);
  const set = (name: keyof ListingForm) => (value: string) =>
    setForm((current) => ({ ...current, [name]: value }));
  const create = useApiMutation(
    (api, input: NewListingInput) => api.sellerCreateListing({ sellerId: shop.id, ...input }),
    { invalidates: [shopKey(shop.id)] },
  );

  if (categories.isPending) return <LoadingState />;
  if (categories.isError)
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />;

  async function send(draft: boolean) {
    const checked = checkNewListing(form, draft);
    if ("error" in checked) return setError(checked.error);
    setError(null);
    setSending(draft ? "draft" : "submit");
    try {
      await create.mutateAsync(checked.input);
      // Back to the list underneath (not a second copy of it), saying what happened.
      router.dismissTo({
        pathname: "/productos",
        params: { creado: draft ? "borrador" : "revision" },
      });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSending(null);
    }
  }

  const byPlatform = form.fulfillment === "platform";
  const top = categories.options.find((option) => option.slug === form.categorySlug)?.top ?? null;

  return (
    <Screen>
      <Text tint="muted">
        Complete los datos una vez; el resumen de abajo le muestra cuánto recibe por cada venta.
      </Text>

      <Card>
        <Text variant="heading">1. El producto</Text>
        <TextField
          label="Título"
          value={form.title}
          onChangeText={set("title")}
          maxLength={200}
          hint="Marca, qué es y la característica principal. Ejemplo: “Licuadora Volcán 600 W vaso de vidrio 1,5 L”."
          testID="listing-title"
        />
        <CategoryField
          options={categories.options}
          value={form.categorySlug}
          onChange={set("categorySlug")}
        />
        <TextField
          label="Características"
          optional
          multiline
          value={form.bullets}
          onChangeText={set("bullets")}
          hint="Una por línea, hasta 8. Lo que alguien necesita saber antes de comprar."
          testID="listing-bullets"
        />
        <TextField
          label="Descripción"
          optional
          multiline
          value={form.description}
          onChangeText={set("description")}
          hint="Sea exacto: lo que usted describe aquí es lo que el comprador tiene derecho a recibir."
        />
      </Card>

      <Card>
        <Text variant="heading">2. Precio</Text>
        <TextField
          label="Precio de venta (₡)"
          value={form.price}
          onChangeText={set("price")}
          inputMode="decimal"
          keyboardType="decimal-pad"
          placeholder="12 500"
          hint="El precio final que paga el comprador, con el IVA incluido."
          testID="listing-price"
        />
      </Card>

      <Card>
        <Text variant="heading">3. Entrega</Text>
        <ChoiceList
          label="Quién despacha"
          value={form.fulfillment as "platform" | "seller"}
          onChange={set("fulfillment")}
          testID="listing-fulfillment"
          choices={[
            {
              value: "platform",
              title: "Yuntera almacena y despacha",
              description:
                "Usted envía su inventario a nuestra bodega. Nosotros lo guardamos, empacamos y entregamos al día siguiente.",
            },
            {
              value: "seller",
              title: "Usted despacha, Yuntera entrega",
              description:
                "Usted guarda el inventario y empaca cada pedido. Nuestro repartidor pasa a recogerlo y lo entrega.",
            },
          ]}
        />
        {byPlatform ? null : (
          <TextField
            label="Días hábiles para alistar un pedido"
            value={form.handlingDays}
            onChangeText={set("handlingDays")}
            keyboardType="number-pad"
            inputMode="numeric"
            hint="Cuenta para la fecha de entrega que le prometemos al comprador. Prometa lo que puede cumplir."
          />
        )}
      </Card>

      <Card>
        <Text variant="heading">4. Paquete</Text>
        <Text variant="small" tint="muted">
          Ya empacado para envío, no solo el producto.
        </Text>
        <PackageFields values={form} onChange={(name, value) => set(name)(value)} />
      </Card>

      <FeePreviewCard
        priceText={form.price}
        topCategory={top}
        byPlatform={byPlatform}
        weightGrams={Number(form.weightGrams)}
        longestSideCm={Math.max(Number(form.lengthCm), Number(form.widthCm), Number(form.heightCm))}
      />

      <Stack gap={3}>
        <FormMessage error={error} testID="listing-result" />
        <Button
          size="lg"
          block
          loading={sending === "submit"}
          disabled={sending !== null}
          loadingLabel="Enviando…"
          onPress={() => void send(false)}
          testID="listing-submit"
        >
          Enviar a revisión
        </Button>
        <Button
          size="lg"
          block
          variant="secondary"
          loading={sending === "draft"}
          disabled={sending !== null}
          loadingLabel="Guardando…"
          onPress={() => void send(true)}
          testID="listing-draft"
        >
          Guardar como borrador
        </Button>
        <Text variant="small" tint="muted">
          Revisamos cada producto nuevo antes de publicarlo, normalmente en un día hábil. Por ahora
          las fotos no se agregan desde la aplicación.
        </Text>
      </Stack>
    </Screen>
  );
}
