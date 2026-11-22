import { ApiError, type ListingContent, type SellerListingDetail } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import { oneParam } from "@yuntera/expo-kit/paths";
import { space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  EmptyState,
  ErrorState,
  FormMessage,
  formatDateTime,
  LinkButton,
  LoadingState,
  Screen,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { CategoryField, PackageFields, useCategoryOptions } from "@/components/listing-fields";
import { ListingChanges } from "@/components/parts";
import { PRODUCT_STATUS } from "@/lib/labels";
import { withPriceFloor } from "@/lib/refusal";
import {
  checkListingEdit,
  type ListingEditForm,
  type ListingEditInput,
  listingEditOutcome,
} from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

const formOf = (content: ListingContent): ListingEditForm => ({
  title: content.title,
  categorySlug: content.category_slug,
  description: content.description ?? "",
  bullets: content.bullet_points.join("\n"),
  weightGrams: String(content.weight_grams),
  lengthCm: String(content.length_cm),
  widthCm: String(content.width_cm),
  heightCm: String(content.height_cm),
});

/** Says plainly where the listing stands and what happens next (the web's `ListingState`). */
// The parts of a message go on separate lines, as on the web: a date ends in
// "p. m." and a reason may end in a full stop, so none is added after them.
function ListingState({
  listing,
  onWithdrawn,
}: {
  listing: SellerListingDetail;
  onWithdrawn: (message: string) => void;
}) {
  const shop = useShop();
  const [error, setError] = useState<string | null>(null);
  const withdraw = useApiMutation(
    (api, productId: string) => api.sellerWithdrawListingEdit(productId),
    { invalidates: [shopKey(shop.id)] },
  );

  if (listing.status === "archived") {
    return (
      <Alert tone="info" title="Este producto está archivado">
        No aparece en la tienda y no se puede vender ni editar. Sus existencias no cambiaron.
      </Alert>
    );
  }
  if (listing.pending) {
    return (
      <Stack gap={4}>
        <Alert
          tone="warning"
          title="Publicado; sus cambios están en revisión"
          testID="edit-pending"
        >
          {`Enviados a revisión el ${formatDateTime(listing.pending.submitted_at)}\nHasta que los aprobemos, los compradores siguen viendo la publicación como está ahora. Si envía otro cambio, reemplaza a este.`}
        </Alert>
        <ListingChanges
          before={listing.content}
          after={listing.pending.proposed}
          afterLabel="Su cambio, en revisión"
        />
        <FormMessage error={error} />
        <Button
          variant="secondary"
          loading={withdraw.isPending}
          loadingLabel="Retirando…"
          testID="withdraw-edit"
          onPress={async () => {
            try {
              await withdraw.mutateAsync(listing.product_id);
              onWithdrawn("Retiramos su cambio. La publicación queda como está.");
            } catch (cause) {
              setError(withPriceFloor(cause, messageOf(cause)));
            }
          }}
        >
          Retirar el cambio
        </Button>
      </Stack>
    );
  }
  if (listing.last_rejection) {
    return (
      <Stack gap={4}>
        <Alert tone="danger" title="No aprobamos su último cambio">
          {`Motivo: ${listing.last_rejection.reason}\nLa publicación sigue a la venta como estaba. Corrija lo que haga falta y envíelo de nuevo.`}
        </Alert>
        <ListingChanges
          before={listing.content}
          after={listing.last_rejection.proposed}
          afterLabel="Lo que usted propuso"
        />
      </Stack>
    );
  }
  switch (listing.status) {
    case "active":
      return (
        <Alert tone="success" title="Publicado y a la venta" testID="edit-state">
          Lo que cambie aquí lo revisamos antes de mostrarlo; mientras tanto su publicación sigue
          igual. El precio y las existencias se cambian sin revisión desde la pantalla del producto.
        </Alert>
      );
    case "pending_review":
      return (
        <Alert tone="warning" title="En revisión; todavía no está publicado" testID="edit-state">
          Puede seguir corrigiéndolo: revisamos la versión más reciente.
        </Alert>
      );
    case "rejected":
      return (
        <Alert tone="danger" title="No lo publicamos" testID="edit-state">
          {`${listing.rejection_reason ? `Motivo: ${listing.rejection_reason}\n` : ""}Corríjalo y envíelo de nuevo a revisión.`}
        </Alert>
      );
    default:
      return (
        <Alert tone="info" title="Borrador" testID="edit-state">
          Nadie más lo ve todavía. Envíelo a revisión cuando esté listo.
        </Alert>
      );
  }
}

/**
 * Edits what a listing says and the package of one variant. `published`
 * decides what sending means: a published listing stays as it is and the
 * change goes to review; anything else is changed in place and can be saved
 * without sending.
 */
function EditForm({
  listing,
  starting,
  onSaved,
}: {
  listing: SellerListingDetail;
  starting: ListingContent;
  onSaved: (message: string) => void;
}) {
  const shop = useShop();
  const published = listing.status === "active";
  const categories = useCategoryOptions(starting.category_slug);
  const [form, setForm] = useState<ListingEditForm>(formOf(starting));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<"submit" | "draft" | null>(null);
  const set = (name: keyof ListingEditForm) => (value: string) =>
    setForm((current) => ({ ...current, [name]: value }));
  const update = useApiMutation(
    (api, input: ListingEditInput) =>
      api.sellerUpdateListing({ productId: listing.product_id, skuId: starting.sku_id, ...input }),
    { invalidates: [shopKey(shop.id)] },
  );

  async function send(draft: boolean) {
    const checked = checkListingEdit(form, draft);
    if ("error" in checked) return setError(checked.error);
    setError(null);
    setSending(draft ? "draft" : "submit");
    try {
      const result = await update.mutateAsync(checked.input);
      onSaved(listingEditOutcome(result.outcome));
    } catch (cause) {
      setError(withPriceFloor(cause, messageOf(cause)));
    } finally {
      setSending(null);
    }
  }

  return (
    <Stack gap={4}>
      <Card>
        <Text variant="heading">El producto</Text>
        <TextField
          label="Título"
          value={form.title}
          onChangeText={set("title")}
          maxLength={200}
          hint="Marca, qué es y la característica principal."
          testID="edit-title"
        />
        <CategoryField
          options={categories.options}
          value={form.categorySlug}
          onChange={set("categorySlug")}
          hint="La comisión depende de la categoría. Si la cambia, la nueva comisión aplica a las ventas siguientes."
        />
        <TextField
          label="Características"
          optional
          multiline
          value={form.bullets}
          onChangeText={set("bullets")}
          hint="Una por línea, hasta 8. Lo que alguien necesita saber antes de comprar."
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
        <Text variant="heading">Paquete</Text>
        <Text variant="small" tint="muted">
          Ya empacado para envío, no solo el producto. El tamaño decide la tarifa de bodega.
        </Text>
        <PackageFields values={form} onChange={(name, value) => set(name)(value)} />
      </Card>
      <FormMessage error={error} testID="edit-error" />
      {published ? (
        <Button
          size="lg"
          block
          loading={sending === "submit"}
          loadingLabel="Enviando…"
          onPress={() => void send(false)}
          testID="edit-submit"
        >
          Enviar cambios a revisión
        </Button>
      ) : (
        <>
          <Button
            size="lg"
            block
            loading={sending === "submit"}
            disabled={sending !== null}
            loadingLabel="Enviando…"
            onPress={() => void send(false)}
            testID="edit-submit"
          >
            Guardar y enviar a revisión
          </Button>
          <Button
            size="lg"
            block
            variant="secondary"
            loading={sending === "draft"}
            disabled={sending !== null}
            loadingLabel="Guardando…"
            onPress={() => void send(true)}
          >
            Guardar sin enviar
          </Button>
        </>
      )}
      <Text variant="small" tint="muted">
        {published
          ? "Revisamos los cambios normalmente en un día hábil. Mientras tanto su publicación sigue a la venta exactamente como está."
          : "Mientras no esté publicado puede cambiarlo las veces que quiera."}
      </Text>
    </Stack>
  );
}

/** Takes the product out of the shop. The tick box makes it a deliberate act. */
function ArchiveForm({
  productId,
  onArchived,
}: {
  productId: string;
  onArchived: (m: string) => void;
}) {
  const shop = useShop();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archive = useApiMutation((api, id: string) => api.sellerArchiveListing(id), {
    invalidates: [shopKey(shop.id)],
  });
  return (
    <Stack gap={3}>
      <Checkbox checked={confirmed} onChange={setConfirmed} testID="archive-confirm">
        <Text variant="small">
          Entiendo que el producto deja de aparecer en la tienda y de venderse.
        </Text>
      </Checkbox>
      <FormMessage error={error} />
      <Button
        variant="danger"
        loading={archive.isPending}
        loadingLabel="Archivando…"
        onPress={async () => {
          if (!confirmed) {
            return setError("Marque la casilla para confirmar que quiere archivar el producto.");
          }
          try {
            await archive.mutateAsync(productId);
            onArchived("Producto archivado. Ya no aparece en la tienda.");
          } catch (cause) {
            setError(withPriceFloor(cause, messageOf(cause)));
          }
        }}
      >
        Archivar producto
      </Button>
    </Stack>
  );
}

/** One listing as its seller edits it, with its review state shown first. */
export default function EditListingScreen() {
  const shop = useShop();
  const params = useLocalSearchParams<{ id: string; v?: string }>();
  const productId = oneParam(params.id) ?? "";
  const [variant, setVariant] = useState(oneParam(params.v) ?? null);
  // Each outcome is shown next to what the seller pressed: the form may be
  // drawn afresh after a change (a new proposal resets it), so it lives here.
  const [message, setMessage] = useState<{ at: "top" | "form" | "archive"; text: string } | null>(
    null,
  );
  const say = (at: "top" | "form" | "archive") => (text: string) => setMessage({ at, text });
  const shown = (at: "top" | "form" | "archive") => (message?.at === at ? message.text : null);
  const listing = useApiQuery(
    shopKey(shop.id, "listing", productId, variant ?? ""),
    (api) => api.sellerListing(productId, variant),
    { personal: true },
  );

  if (listing.isPending) return <LoadingState />;
  if (listing.isError) {
    // Someone else's product and one that does not exist look the same: not found.
    if (listing.error instanceof ApiError && listing.error.code === "listing_not_found") {
      return <NotFound />;
    }
    return <ErrorState error={listing.error} onRetry={() => void listing.refetch()} />;
  }
  const data = listing.data;
  // It belongs to another of this person's shops: they are working in this one.
  if (data.seller_id !== shop.id) return <NotFound />;

  const status = PRODUCT_STATUS[data.status];
  const archived = data.status === "archived";
  // The form starts from what the seller last proposed, so they continue from there.
  const starting = data.pending?.proposed ?? data.last_rejection?.proposed ?? data.content;

  return (
    <Screen refreshing={listing.isRefetching} onRefresh={() => void listing.refetch()}>
      <Stack gap={2}>
        <Text variant="title" testID="edit-heading">
          {data.content.title}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {data.pending ? <Badge tone="warning">Cambios en revisión</Badge> : null}
        </View>
      </Stack>

      <FormMessage ok={shown("top")} testID="withdraw-result" />
      <ListingState listing={data} onWithdrawn={say("top")} />

      {archived ? null : (
        <>
          {data.variants.length > 1 ? (
            <Stack gap={2}>
              <Text variant="smallStrong">El paquete que edita es el de la variante:</Text>
              <ChoiceList
                label="Variante"
                value={data.content.sku_id}
                onChange={(skuId) => {
                  setMessage(null);
                  setVariant(skuId);
                }}
                choices={data.variants.map((v) => ({
                  value: v.sku_id,
                  title: v.variant_name || v.sku_code,
                }))}
              />
            </Stack>
          ) : null}

          <EditForm
            // A new proposal, or a decision on one, starts the form afresh.
            key={`${data.status}:${data.pending?.request_id ?? "none"}:${data.content.sku_id}`}
            listing={data}
            starting={starting}
            onSaved={say("form")}
          />
          <FormMessage ok={shown("form")} testID="edit-result" />

          <Card>
            <Text variant="heading">Archivar el producto</Text>
            <FormMessage ok={shown("archive")} testID="archive-result" />
            {data.shared ? (
              <Text variant="small" tint="muted">
                Otro vendedor también vende desde esta publicación, así que no se puede archivar. Si
                usted ya no lo vende, ponga su oferta en pausa desde la pantalla del producto.
              </Text>
            ) : (
              <>
                <Text variant="small" tint="muted">
                  El producto desaparece de la tienda y deja de venderse. Sus existencias, sus
                  pedidos anteriores y sus pagos no cambian.
                </Text>
                <ArchiveForm productId={data.product_id} onArchived={say("archive")} />
              </>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

function NotFound() {
  return (
    <EmptyState
      title="No encontramos ese producto"
      action={<LinkButton href="/productos">Ver sus productos</LinkButton>}
    >
      No está entre los de esta tienda. Si trabaja en varias, revise en cuál está.
    </EmptyState>
  );
}
