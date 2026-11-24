import { messageOf } from "@yuntera/expo-kit/api";
import { useSession } from "@yuntera/expo-kit/auth";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { oneParam, safeReturnPath, signInPath } from "@yuntera/expo-kit/paths";
import {
  Button,
  ErrorState,
  FormMessage,
  LoadingState,
  Screen,
  Text,
  TextField,
} from "@yuntera/expo-kit/ui";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { DistrictPicker } from "@/components/district-picker";
import { KeptNotice } from "@/components/kept-notice";
import { type Pin, PinPicker } from "@/components/pin-picker";
import { validateAddress } from "@/lib/address";
import { useCart } from "@/lib/cart-context";
import { useDistricts } from "@/lib/catalog";
import { needsSignIn } from "@/lib/guard";
import { firstReadFailed, KEPT, refreshFailed } from "@/lib/kept-reads";

/**
 * A delivery address the Costa Rican way: the district, the "señas" a
 * neighbour would give, and the exact point the driver navigates to.
 */
export default function NewAddressScreen() {
  const params = useLocalSearchParams<{ siguiente?: string }>();
  const returnTo = safeReturnPath(oneParam(params.siguiente) ?? "/cuenta");
  const { status, viewer } = useSession();
  const cart = useCart();
  const districts = useDistricts();
  const [recipientName, setRecipientName] = useState(viewer?.name ?? "");
  const [phone, setPhone] = useState("");
  const [postalCode, setPostalCode] = useState(cart.locationChosen ? cart.postalCode : "");
  const [senas, setSenas] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation(
    (api, input: Parameters<typeof api.saveAddress>[0]) => api.saveAddress(input),
    {
      invalidates: [["addresses"]],
    },
  );

  if (needsSignIn(status))
    return (
      <Redirect href={signInPath(`/direcciones/nueva?siguiente=${encodeURIComponent(returnTo)}`)} />
    );

  async function submit() {
    const result = validateAddress({ recipientName, phone, postalCode, senas, pin });
    if (result.error !== undefined) {
      setError(result.error);
      return;
    }
    setError(null);
    try {
      await save.mutateAsync(result.input);
      cart.setLocation(result.input.postalCode);
      if (router.canGoBack()) router.back();
      else router.replace(returnTo as never);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <Screen
      footer={
        <>
          <FormMessage error={error} testID="address-message" />
          <Button
            block
            size="lg"
            loading={save.isPending}
            loadingLabel="Guardando…"
            onPress={submit}
            testID="address-save"
          >
            Guardar dirección
          </Button>
        </>
      }
    >
      <Text tint="muted">La guardamos para sus próximas compras.</Text>
      <TextField
        label="Nombre de quien recibe"
        value={recipientName}
        onChangeText={setRecipientName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
      />
      <TextField
        label="Teléfono"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        inputMode="tel"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="8888-1234"
        hint="El repartidor llama o escribe a este número si no encuentra la casa."
      />
      {districts.isPending ? (
        <LoadingState label="Cargando distritos…" />
      ) : firstReadFailed(districts) || !districts.data ? (
        <ErrorState error={districts.error} onRetry={() => void districts.refetch()} />
      ) : (
        <>
          {refreshFailed(districts) ? (
            <KeptNotice
              title={KEPT.districts.title}
              body={KEPT.districts.body}
              error={districts.error}
              onRetry={() => void districts.refetch()}
              retrying={districts.isFetching}
              testID="districts-kept"
            />
          ) : null}
          <DistrictPicker
            districts={districts.data}
            postalCode={postalCode}
            onChange={setPostalCode}
          />
        </>
      )}
      <TextField
        label="Señas"
        value={senas}
        onChangeText={setSenas}
        multiline
        placeholder="De la iglesia 200 metros al sur y 50 al este, casa esquinera con portón negro"
        hint="Como se las daría a un vecino: referencias, color de la casa, portón, número de apartamento."
      />
      <PinPicker pin={pin} onChange={setPin} />
    </Screen>
  );
}
