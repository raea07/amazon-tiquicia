import { ApiError, type CountCandidate, type WmsLocationStock } from "@yuntera/db";
import { messageOf, useApi } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { BarcodeScanner, findByForms, type ScanFeedback } from "@yuntera/expo-kit/scanner";
import { colors, radius, space } from "@yuntera/expo-kit/theme";
import {
  Alert,
  Button,
  ChoiceList,
  FormMessage,
  LinkButton,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { camera } from "@/lib/camera";
import {
  countedInText,
  countInButton,
  elsewhereText,
  keepResults,
  listedText,
  noCountHere,
  notFoundText,
  parseCountIn,
  receiptText,
  searchable,
} from "@/lib/count-in";

/** What reads must be fetched again after a count, here and elsewhere. */
const AFTER = [["wms-location"], ["wms-stock-locations"], ["wms-sku"]];

const named = (product: CountCandidate) =>
  `${product.title}${product.variant_name ? ` (${product.variant_name})` : ""}`;

/**
 * The count of one product the location does not list: the shop (asked only
 * when more than one shop keeps it in this warehouse, never chosen for the
 * worker), how many and why. After a refusal it stays as typed, even when the
 * refusal is that the product is now listed here (its words say where to count).
 */
function CountInForm({
  location,
  product,
  closed,
  onDone,
  onRefused,
}: {
  location: { id: string; code: string };
  product: CountCandidate;
  /** The location takes no counts now (switched off): the form stays only to show its refusal. */
  closed: boolean;
  onDone: (message: string) => void;
  onRefused: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const count = useApiMutation(
    (api, input: { sellerId: string; quantity: number; note: string }) =>
      api.wmsCountIntoLocation({
        locationId: location.id,
        skuId: product.sku_id,
        ...input,
      }),
    { invalidates: AFTER },
  );
  const shops = product.shops.filter((shop) => shop.stock_record);
  const offered = error ? shops : closed ? [] : shops.filter((shop) => !shop.listed);
  if (offered.length === 0) return null;
  const only = offered.length === 1 ? offered[0] : undefined;
  const sellerId = only
    ? only.seller_id
    : picked && offered.some((shop) => shop.seller_id === picked)
      ? picked
      : null;
  const save = async () => {
    const input = parseCountIn({ sellerId, quantity, note });
    if ("error" in input) return setError(input.error);
    setError(null);
    try {
      const counted = await count.mutateAsync(input);
      onDone(countedInText(counted.quantity, counted.sku_code));
    } catch (failure) {
      // What the database said, with what was typed kept; the location and
      // the lookup are read again (someone counted or moved it here meanwhile).
      setError(messageOf(failure));
      if (failure instanceof ApiError) onRefused();
    }
  };
  return (
    <Stack gap={3}>
      {only ? (
        <Text variant="small">{`Unidades de ${only.seller_name}.`}</Text>
      ) : (
        <Stack gap={2}>
          <Text variant="smallStrong">¿De qué tienda son?</Text>
          <Text variant="caption" tint="muted">
            Mire la etiqueta de la tienda en el producto o en su caja.
          </Text>
          <ChoiceList
            label={`De qué tienda son las unidades de ${named(product)}`}
            value={sellerId}
            onChange={setPicked}
            choices={offered.map((shop) => ({ value: shop.seller_id, title: shop.seller_name }))}
            testID="count-in-shop"
          />
        </Stack>
      )}
      <TextField
        label="Unidades que contó en el estante"
        aria-label={`Unidades que contó de ${named(product)}`}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="number-pad"
        inputMode="numeric"
        hint="Desde 1 hasta 10 000."
        testID="count-in-quantity"
      />
      <TextField
        label="Motivo"
        value={note}
        onChangeText={setNote}
        hint="Al menos 5 letras, por ejemplo «estaban detrás de otra caja». La tienda ve este motivo en su historial de inventario."
        testID="count-in-note"
      />
      <FormMessage error={error} testID="count-in-error" />
      <Button
        variant="secondary"
        block
        loading={count.isPending}
        loadingLabel="Sumando…"
        onPress={() => void save()}
        testID="count-in-submit"
      >
        {countInButton(quantity, location.code)}
      </Button>
    </Stack>
  );
}

/**
 * "Count a product that is not in the list", as on the web's location page:
 * the worker found units of a product here that the list does not show,
 * scans or types its code (or searches by name), chooses the shop and counts.
 * A product no shop keeps in this warehouse cannot be counted: its first
 * units come in with a receipt.
 */
export function CountIn({
  location,
  onDone,
  onRefused,
}: {
  location: WmsLocationStock;
  onDone: (message: string) => void;
  onRefused: () => void;
}) {
  const api = useApi();
  const [found, setFound] = useState<CountCandidate[] | null>(null);
  const [asked, setAsked] = useState("");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // A new scanner (with no answer left from an earlier code) after a name
  // search or a count: its last words are never read next to another result.
  const [scanner, setScanner] = useState(0);
  const closed = noCountHere(location);
  const here = { id: location.id, code: location.code };

  const lookup = (query: string) => api.wmsCountCandidates(location.id, query);
  const onScan = async (code: string): Promise<ScanFeedback> => {
    // The form that found it (a UPC-A read as 13 digits, say) is the one
    // asked again after a refusal: the code as read may match nothing.
    let matched = code;
    const list = await findByForms(code, async (form) => {
      const answer = await lookup(form);
      if (answer.length === 0) return null;
      matched = form;
      return answer;
    });
    // Not found: the scanner says so where the worker is looking.
    setAsked(list ? matched : "");
    setFound(list);
    return list
      ? { tone: "success", message: `Encontrado: ${list[0]?.title ?? code}.` }
      : { tone: "warning", message: notFoundText(location.warehouse.name, code) };
  };
  const searchName = async () => {
    if (!searchable(name)) {
      setNameError("Escriba al menos 2 letras del nombre del producto.");
      return;
    }
    setNameError(null);
    setScanner((n) => n + 1);
    setSearching(true);
    try {
      setAsked(name.trim());
      setFound(await lookup(name.trim()));
    } catch (failure) {
      setNameError(messageOf(failure));
    } finally {
      setSearching(false);
    }
  };
  // After a refusal: the lookup again, so a product now listed here says so.
  // What was shown keeps its place (and its form, with the refusal).
  const again = () => {
    if (asked) {
      lookup(asked)
        .then((fresh) => setFound((shown) => keepResults(shown, fresh)))
        .catch(() => undefined);
    }
    onRefused();
  };

  return (
    <View style={styles.box} testID="count-in">
      <Text variant="heading">Contar un producto que no está en la lista</Text>
      {/* One slot each, whatever the location's state: a form refused because
          the location was switched off meanwhile keeps its place (its refusal
          and what was typed) when the location is read again. */}
      {closed ? (
        <Text tint="muted" testID="count-in-closed">
          {closed}
        </Text>
      ) : (
        <Text tint="muted">
          ¿Encontró aquí unidades de un producto que la lista no muestra? Escanee o escriba su
          código, o búsquelo por su nombre, y cuente lo que hay.
        </Text>
      )}
      {/* The camera starts only when the worker asks for it, not with the location. */}
      {closed || searchOpen ? null : (
        <Button
          variant="secondary"
          block
          onPress={() => setSearchOpen(true)}
          testID="count-in-open"
        >
          Buscar el producto
        </Button>
      )}
      {closed || !searchOpen ? null : (
        <>
          <BarcodeScanner
            key={scanner}
            camera={camera}
            label="Código de barras o código YT"
            hint="El de la etiqueta del producto."
            submitLabel="Buscar"
            submittingLabel="Buscando…"
            onScan={onScan}
            testID="count-in-scan"
          />
          <TextField
            label="O busque por su nombre"
            value={name}
            onChangeText={setName}
            hint="Por ejemplo, «libreta»."
            error={nameError ?? undefined}
            testID="count-in-name"
          />
          <Button
            variant="secondary"
            block
            loading={searching}
            loadingLabel="Buscando…"
            onPress={() => void searchName()}
            testID="count-in-name-submit"
          >
            Buscar por nombre
          </Button>
          {found && found.length === 0 && asked ? (
            <Alert tone="warning" title="No encontramos ese producto" testID="count-in-none">
              {notFoundText(location.warehouse.name, asked)}
            </Alert>
          ) : null}
        </>
      )}
      {found?.map((product) => {
        const kept = product.shops.filter((shop) => shop.stock_record);
        const elsewhere = product.shops.filter((shop) => !shop.stock_record);
        return (
          <View
            key={product.sku_id}
            style={styles.result}
            testID={`count-in-result-${product.sku_code}`}
          >
            <Stack gap={1}>
              <Text variant="bodyStrong">{named(product)}</Text>
              <Text variant="small" tint="muted">
                {product.sku_code}
                {product.gtin ? ` · ${product.gtin}` : ""}
              </Text>
            </Stack>
            {kept.length === 0 ? (
              <Stack gap={2}>
                <Alert tone="info" title="No se puede contar aquí" testID="count-in-receipt">
                  {receiptText(location.warehouse.name)}
                </Alert>
                <LinkButton href="/" variant="secondary">
                  Ver la mercadería por recibir
                </LinkButton>
              </Stack>
            ) : (
              <Stack gap={3}>
                {kept
                  .filter((shop) => shop.listed)
                  .map((shop) => (
                    <Text key={shop.seller_id} testID="count-in-listed">
                      {listedText(shop.seller_name, shop.on_shelf)}
                    </Text>
                  ))}
                {elsewhere.map((shop) => (
                  <Text key={shop.seller_id} variant="small" tint="muted">
                    {elsewhereText(shop.seller_name)}
                  </Text>
                ))}
                <CountInForm
                  location={here}
                  product={product}
                  closed={closed !== null}
                  onDone={(message) => {
                    setFound(null);
                    setAsked("");
                    setName("");
                    setScanner((n) => n + 1);
                    onDone(message);
                  }}
                  onRefused={again}
                />
              </Stack>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  result: {
    gap: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
