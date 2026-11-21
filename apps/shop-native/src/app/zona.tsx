import { Button, ErrorState, FormMessage, LoadingState, Screen, Text } from "@yuntera/expo-kit/ui";
import { router } from "expo-router";
import { useState } from "react";
import { DistrictPicker } from "@/components/district-picker";
import { isPostalCode } from "@/lib/cart";
import { useCart } from "@/lib/cart-context";
import { useDistricts } from "@/lib/catalog";

/** "¿Dónde le entregamos?": the district delivery dates and shipping are worked out for. */
export default function ZoneScreen() {
  const cart = useCart();
  const districts = useDistricts();
  const [postalCode, setPostalCode] = useState(cart.locationChosen ? cart.postalCode : "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!isPostalCode(postalCode)) {
      setError("Elija la provincia, el cantón y el distrito.");
      return;
    }
    cart.setLocation(postalCode);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <Screen
      footer={
        <>
          <FormMessage error={error} />
          <Button block size="lg" onPress={save} testID="zone-save">
            Usar esta zona
          </Button>
        </>
      }
    >
      <Text variant="title">¿Dónde le entregamos?</Text>
      <Text tint="muted">
        Con su distrito le mostramos la fecha de entrega y el costo de envío reales. Por ahora
        llegamos al Gran Área Metropolitana.
      </Text>
      {districts.isPending ? (
        <LoadingState label="Cargando distritos…" />
      ) : districts.isError ? (
        <ErrorState error={districts.error} onRetry={() => void districts.refetch()} />
      ) : (
        <DistrictPicker
          districts={districts.data}
          postalCode={postalCode}
          onChange={setPostalCode}
        />
      )}
    </Screen>
  );
}
