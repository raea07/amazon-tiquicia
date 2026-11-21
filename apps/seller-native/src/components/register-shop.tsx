import { parsePhone } from "@yuntera/core";
import { ApiError } from "@yuntera/db";
import { messageOf } from "@yuntera/expo-kit/api";
import { useSession } from "@yuntera/expo-kit/auth";
import {
  Button,
  Card,
  Checkbox,
  ChoiceList,
  FormMessage,
  Stack,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { checkShop, ID_TYPE_LABEL, ID_TYPES, type ShopForm } from "@/lib/rules";
import { useShops } from "@/lib/shops";

/**
 * The seller centre's shop registration (`RegisterShopForm` and the
 * `registerShop` action): the same fields, checks and words. The shop starts
 * "in review" until Yuntera verifies the seller's identity; meanwhile the
 * seller can already create products.
 *
 * `onRegistered` runs with the new shop's id once the person's roles have been
 * read again, so the app opens on that shop.
 */
export function RegisterShopForm({ onRegistered }: { onRegistered?: (shopId: string) => void }) {
  const { viewer, api, reloadRoles } = useSession();
  const { choose, setJustRegistered } = useShops();
  const [form, setForm] = useState<ShopForm>({
    tradeName: "",
    legalName: "",
    idType: "fisica",
    idNumber: "",
    contactEmail: viewer?.email ?? "",
    contactPhone: "",
    fiscalAddress: "",
    declared: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (name: keyof ShopForm) => (value: string) =>
    setForm((current) => ({ ...current, [name]: value }));
  const phone = form.contactPhone.trim() ? parsePhone(form.contactPhone) : null;

  async function submit() {
    const checked = checkShop(form);
    if ("error" in checked) return setError(checked.error);
    setError(null);
    setBusy(true);
    const create = (slug: string) => api.createSeller({ ...checked.input, slug });
    try {
      let shopId: string;
      try {
        shopId = await create(checked.input.slug);
      } catch (cause) {
        // Two shops can share a name; their addresses cannot. Try once with a
        // suffix. It only tells two public addresses apart, so it needs no
        // secure random source (and the app ships no crypto module).
        if (!(cause instanceof ApiError && cause.code === "slug_taken")) throw cause;
        shopId = await create(`${checked.input.slug}-${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`);
      }
      await choose(shopId);
      setJustRegistered(shopId);
      await reloadRoles();
      onRegistered?.(shopId);
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  }

  return (
    <Stack gap={4}>
      <Card>
        <Text variant="heading">Su tienda</Text>
        <TextField
          label="Nombre de la tienda"
          value={form.tradeName}
          onChangeText={set("tradeName")}
          maxLength={80}
          hint="Es el nombre que ven los compradores, por ejemplo “Cafetal Los Santos”."
          testID="shop-trade-name"
        />
      </Card>

      <Card>
        <Text variant="heading">Quién vende</Text>
        <Text variant="small" tint="muted">
          Estos datos deben coincidir con su inscripción en Hacienda. Los usamos para verificar su
          identidad y para los informes que la ley nos pide; los compradores no los ven.
        </Text>
        <Text variant="smallStrong">Tipo de identificación</Text>
        <ChoiceList
          label="Tipo de identificación"
          value={form.idType as (typeof ID_TYPES)[number]}
          onChange={set("idType")}
          testID="shop-id-type"
          choices={ID_TYPES.map((type) => ({ value: type, title: ID_TYPE_LABEL[type] }))}
        />
        <TextField
          label="Número de identificación"
          value={form.idNumber}
          onChangeText={set("idNumber")}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="1-0234-0567"
          testID="shop-id-number"
        />
        <TextField
          label="Nombre o razón social"
          value={form.legalName}
          onChangeText={set("legalName")}
          hint="Tal como aparece en su cédula o en el Registro Nacional."
          testID="shop-legal-name"
        />
        <TextField
          label="Dirección fiscal"
          multiline
          value={form.fiscalAddress}
          onChangeText={set("fiscalAddress")}
          placeholder="San José, Montes de Oca, San Pedro, de la Fuente de la Hispanidad 300 m sur"
          testID="shop-fiscal-address"
        />
      </Card>

      <Card>
        <Text variant="heading">Contacto</Text>
        <TextField
          label="Correo de contacto"
          value={form.contactEmail}
          onChangeText={set("contactEmail")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          testID="shop-email"
        />
        <TextField
          label="Teléfono"
          value={form.contactPhone}
          onChangeText={set("contactPhone")}
          keyboardType="phone-pad"
          inputMode="tel"
          placeholder="8888-1234"
          hint={phone ? `Lo guardamos como ${phone.formatted}.` : undefined}
          testID="shop-phone"
        />
      </Card>

      <Checkbox
        checked={form.declared}
        onChange={(declared) => setForm((current) => ({ ...current, declared }))}
        testID="shop-declare"
      >
        <Text variant="small">
          Declaro que estos datos son verdaderos y que estoy inscrito como contribuyente ante el
          Ministerio de Hacienda.
        </Text>
      </Checkbox>

      <FormMessage error={error} testID="shop-result" />
      <Button
        size="lg"
        block
        loading={busy}
        loadingLabel="Enviando su solicitud…"
        onPress={() => void submit()}
        testID="shop-submit"
      >
        Enviar solicitud
      </Button>
    </Stack>
  );
}
