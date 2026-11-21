import { useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import {
  Button,
  Card,
  ErrorState,
  formatDate,
  InfoRow,
  LoadingState,
  Logo,
  Screen,
  Text,
} from "@yuntera/expo-kit/ui";

/**
 * Home of the drivers' app: today's route, read from the API. A starting point
 * for the route, stop and delivery screens to come.
 */
export default function HomeScreen() {
  const { viewer, signOut } = useSession();
  const day = useApiQuery(["driver-today"], (api) => api.driverToday(), { personal: true });
  const route = day.data?.routes[0];

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      refreshing={day.isRefetching}
      onRefresh={() => void day.refetch()}
    >
      <Logo app="driver" size={30} />
      <Text variant="title">Hola{viewer?.name ? `, ${viewer.name.split(" ")[0]}` : ""}</Text>
      {day.isPending ? (
        <LoadingState label="Buscando su ruta de hoy…" />
      ) : day.isError ? (
        <ErrorState error={day.error} onRetry={() => void day.refetch()} />
      ) : route ? (
        <Card testID="driver-route">
          <Text variant="heading">Ruta {route.code}</Text>
          <InfoRow label="Fecha" value={formatDate(route.service_date)} />
          <InfoRow label="Paradas" value={String(route.stops.length)} />
          <InfoRow label="Sale de" value={route.depot.name} />
        </Card>
      ) : (
        <Card testID="driver-route">
          <Text variant="heading">Hoy no tiene una ruta asignada</Text>
          <Text tint="muted">
            Cuando Central le asigne una, aparecerá aquí. Deslice hacia abajo para revisar.
          </Text>
        </Card>
      )}
      <Text tint="muted">
        Pronto podrá iniciar la ruta, navegar a cada parada y registrar las entregas desde aquí.
      </Text>
      <Button variant="ghost" block onPress={() => void signOut()} testID="sign-out">
        Cerrar sesión
      </Button>
    </Screen>
  );
}
