import type { WmsStockLocation } from "@yuntera/db";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { BarcodeScanner, type ScanFeedback } from "@yuntera/expo-kit/scanner";
import {
  Badge,
  Card,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  Stack,
  Text,
} from "@yuntera/expo-kit/ui";
import { router } from "expo-router";
import { camera } from "@/lib/camera";
import { plural } from "@/lib/floor";
import { LOCATION_KIND } from "@/lib/stock-labels";
import { keys, useWarehouse } from "@/lib/warehouse";

/**
 * The warehouse's locations, as the web's /bodega/ubicaciones: scan a
 * shelf's label (or type its code) to open it, or choose it from the list.
 * Switched-off locations are listed only while they still hold stock, so
 * they can be emptied.
 */
export default function LocationsScreen() {
  const { warehouse } = useWarehouse();
  const locations = useApiQuery(
    keys.stockLocations(warehouse.id),
    (api) => api.wmsStockLocations(warehouse.id),
    { personal: true },
  );

  const open = (code: string) =>
    router.push({ pathname: "/ubicacion/[codigo]", params: { codigo: code } });

  const onScan = async (code: string): Promise<ScanFeedback> => {
    const wanted = code.trim().toUpperCase();
    const found = locations.data?.find((location) => location.code === wanted);
    if (!found && locations.data) {
      return {
        tone: "warning",
        message: `En esta bodega no hay ninguna ubicación con el código “${code}”. Revise la etiqueta.`,
      };
    }
    open(wanted);
    return { tone: "success", message: `Abriendo ${wanted}.` };
  };

  if (locations.isPending) return <LoadingState label="Cargando las ubicaciones…" />;
  if (locations.isError) {
    return <ErrorState error={locations.error} onRetry={() => void locations.refetch()} />;
  }
  const shelves = locations.data.filter((location) => location.shelf);
  const areas = locations.data.filter((location) => !location.shelf);
  return (
    <Screen refreshing={locations.isRefetching} onRefresh={() => void locations.refetch()}>
      <Card>
        <BarcodeScanner
          camera={camera}
          label="Código de la ubicación"
          hint="Escanee la etiqueta del estante o escriba su código, por ejemplo A-01-02-B."
          submitLabel="Abrir"
          submittingLabel="Abriendo…"
          onScan={onScan}
          testID="location-scan"
        />
      </Card>
      <Group title={`Estantes (${shelves.length})`} locations={shelves} onOpen={open} />
      {areas.length > 0 ? (
        <Group title={`Otras áreas (${areas.length})`} locations={areas} onOpen={open} />
      ) : null}
    </Screen>
  );
}

function Group({
  title,
  locations,
  onOpen,
}: {
  title: string;
  locations: WmsStockLocation[];
  onOpen: (code: string) => void;
}) {
  return (
    <Stack gap={2}>
      <Text variant="heading">{title}</Text>
      {locations.length === 0 ? (
        <Text tint="muted">No hay ninguna.</Text>
      ) : (
        <Card>
          {locations.map((location) => (
            <ListRow
              key={location.id}
              title={location.code}
              subtitle={`${LOCATION_KIND[location.kind]} · ${
                location.units === 0
                  ? "vacía"
                  : `${plural(location.units, "unidad", "unidades")} · ${plural(
                      location.products,
                      "producto",
                      "productos",
                    )}`
              }`}
              trailing={location.active ? undefined : <Badge tone="warning">Desactivada</Badge>}
              onPress={() => onOpen(location.code)}
              testID={`location-${location.code}`}
            />
          ))}
        </Card>
      )}
    </Stack>
  );
}
