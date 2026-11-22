import { useQueryClient } from "@tanstack/react-query";
import { NotificationChoicesForm, phoneToOffer } from "@yuntera/expo-kit/account";
import { useApi, useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { signInPath } from "@yuntera/expo-kit/paths";
import { Card, ErrorState, LoadingState, Screen, Text } from "@yuntera/expo-kit/ui";
import { Redirect } from "expo-router";

/**
 * Notificaciones (the website's /cuenta/notificaciones): which channels the
 * shopper accepts for the messages about their orders, the mobile number for
 * WhatsApp and SMS, and the separate consent for commercial messages.
 */
export default function NotificationsScreen() {
  const { status, viewer } = useSession();
  const api = useApi();
  const client = useQueryClient();
  const settings = useApiQuery(["notification-settings"], (a) => a.myNotificationSettings(), {
    personal: true,
  });

  if (status === "signedOut") return <Redirect href={signInPath("/cuenta/notificaciones")} />;
  if (settings.isPending) return <LoadingState />;
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const data = settings.data;
  return (
    <Screen>
      <Text tint="muted">
        Elija por dónde quiere que le avisemos de sus pedidos. Nunca le enviaremos su código de
        entrega, su dirección ni datos de pago: para eso, abra la página del pedido.
      </Text>
      <Card testID="notification-settings">
        <NotificationChoicesForm
          audience="shopper"
          settings={data}
          phone={phoneToOffer(data.phone, data.profile_phone)}
          save={async (input) => {
            const saved = await api.setMyNotificationSettings(input);
            client.setQueryData(
              ["user", viewer?.id ?? "anonymous", "notification-settings"],
              saved,
            );
            void client.invalidateQueries({
              queryKey: ["user", viewer?.id ?? "anonymous", "profile"],
            });
            return saved;
          }}
        />
      </Card>
    </Screen>
  );
}
