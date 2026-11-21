import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation, useApiQuery } from "@yuntera/expo-kit/data";
import {
  Button,
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
import { type Pin, PinPicker } from "@/components/pin-picker";
import { DistrictPicker } from "@/components/select";
import { checkLocation, type LocationInput } from "@/lib/rules";
import { shopKey, useShop } from "@/lib/shops";

/**
 * Where our driver collects the parcels of a seller who ships their own
 * products: a name, the district, the "señas" and the exact point. Without
 * it those products cannot be offered.
 */
export default function LocationScreen() {
  const shop = useShop();
  const districts = useApiQuery(["districts"], (api) => api.listDistricts(), {
    staleTime: 24 * 60 * 60_000,
  });
  const [name, setName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (api, input: LocationInput) => api.sellerSaveLocation({ sellerId: shop.id, ...input }),
    { invalidates: [shopKey(shop.id)] },
  );

  if (districts.isPending) return <LoadingState />;
  if (districts.isError)
    return <ErrorState error={districts.error} onRetry={() => void districts.refetch()} />;

  return (
    <Screen>
      <Text tint="muted">
        Es el lugar adonde va nuestro repartidor a recoger los paquetes de lo que usted despacha.
      </Text>
      <TextField
        label="Nombre del lugar"
        value={name}
        onChangeText={setName}
        placeholder="Local Heredia"
        maxLength={80}
        testID="location-name"
      />
      <DistrictPicker districts={districts.data} postalCode={postalCode} onChange={setPostalCode} />
      <TextField
        label="Señas"
        multiline
        value={address}
        onChangeText={setAddress}
        placeholder="Heredia centro, 100 metros este del Mercado, local con rótulo verde"
        hint="Como se las daría a un mensajero. Incluya el horario si no es todo el día."
        testID="location-address"
      />
      <PinPicker
        pin={pin}
        onChange={(next) => {
          setPin(next);
          // The point is now marked: drop the old message; saving checks everything again.
          if (next) setError(null);
        }}
      />
      <Stack gap={3}>
        <FormMessage error={error} testID="location-result" />
        <Button
          block
          size="lg"
          loading={save.isPending}
          loadingLabel="Guardando…"
          testID="location-save"
          onPress={async () => {
            const checked = checkLocation({
              name,
              address,
              postalCode,
              lat: pin?.lat ?? null,
              lng: pin?.lng ?? null,
            });
            if ("error" in checked) return setError(checked.error);
            try {
              await save.mutateAsync(checked.input);
              router.back();
            } catch (cause) {
              setError(messageOf(cause));
            }
          }}
        >
          Guardar ubicación
        </Button>
      </Stack>
    </Screen>
  );
}
