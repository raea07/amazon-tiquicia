import { useQueryClient } from "@tanstack/react-query";
import { NotificationChoicesForm, phoneToOffer } from "@yuntera/expo-kit/account";
import { useApi, useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { signInPath } from "@yuntera/expo-kit/paths";
import { Card, ErrorState, LoadingState, Screen, Text } from "@yuntera/expo-kit/ui";
import { Redirect } from "expo-router";
import { useState } from "react";
import { needsSignIn } from "@/lib/guard";

/**
 * Notificaciones (the website's /cuenta/notificaciones): which channels the
 * shopper accepts for the messages about their orders, the mobile number for
 * WhatsApp and SMS, and the separate consent for commercial messages,
 * recorded as given in the app ('shop_app').
 *
 * Always loaded fresh (no cache kept once the screen closes): settings saved
 * on another phone or on the website must show the moment it opens. Pulling
 * down loads them again.
 */
export default function NotificationsScreen() {
  const { status, viewer } = useSession();
  const api = useApi();
  const client = useQueryClient();
  const [loaded, setLoaded] = useState(0);
  const key = ["user", viewer?.id ?? "anonymous", "notification-settings"];
  const settings = useApiQuery(["notification-settings"], (a) => a.myNotificationSettings(), {
    personal: true,
    staleTime: 0,
    gcTime: 0,
  });

  if (needsSignIn(status)) return <Redirect href={signInPath("/cuenta/notificaciones")} />;
  if (settings.isPending) return <LoadingState />;
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  const data = settings.data;
  return (
    <Screen
      refreshing={settings.isRefetching}
      onRefresh={() => {
        void settings.refetch().then(() => setLoaded((n) => n + 1));
      }}
    >
      <Text tint="muted">
        Elija por dónde quiere que le avisemos de sus pedidos. Nunca le enviaremos su código de
        entrega, su dirección ni datos de pago: para eso, abra la página del pedido.
      </Text>
      <Card testID="notification-settings">
        <NotificationChoicesForm
          // A pull-to-refresh starts the form again from what is stored.
          key={loaded}
          audience="shopper"
          settings={data}
          phone={phoneToOffer(data.phone, data.profile_phone)}
          save={async (input) => {
            const saved = await api.setMyNotificationSettingsFrom("shop_app", input);
            client.setQueryData(key, saved);
            void client.invalidateQueries({
              queryKey: ["user", viewer?.id ?? "anonymous", "profile"],
            });
            return saved;
          }}
          reload={async () => {
            const now = await api.myNotificationSettings();
            client.setQueryData(key, now);
            return now;
          }}
        />
      </Card>
    </Screen>
  );
}
