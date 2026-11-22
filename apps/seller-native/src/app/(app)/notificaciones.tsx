import { useQueryClient } from "@tanstack/react-query";
import { NotificationChoicesForm, phoneToOffer } from "@yuntera/expo-kit/account";
import { useApi, useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { Card, ErrorState, LoadingState, Screen, Text } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import { shopKey, useShop } from "@/lib/shops";

/**
 * The shop's notification settings (the seller centre's
 * /cuenta/notificaciones): how the shop is told of new and cancelled orders
 * and the review of its products, and its consent for commercial messages.
 * Only the owner or an administrator may change them; the others see them.
 * A consent given here is recorded as given in the app ('seller_app').
 *
 * Always loaded fresh (no cache kept once the screen closes): settings saved
 * on another phone or in the seller centre must show the moment it opens.
 * Pulling down loads them again.
 */
export default function ShopNotificationsScreen() {
  const shop = useShop();
  const api = useApi();
  const { viewer } = useSession();
  const client = useQueryClient();
  const [loaded, setLoaded] = useState(0);
  const key = shopKey(shop.id, "notification-settings");
  const cached = ["user", viewer?.id ?? "anonymous", ...key];
  const settings = useApiQuery(key, (a) => a.sellerNotificationSettings(shop.id), {
    personal: true,
    staleTime: 0,
    gcTime: 0,
  });

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
        Cómo le avisamos de pedidos nuevos, pedidos cancelados y la revisión de sus productos.
      </Text>
      <Card testID="shop-notification-settings">
        <Text variant="small" tint="muted">
          Los correos van a <Text variant="smallStrong">{data.contact_email}</Text>, el correo de
          contacto de {shop.trade_name}.
        </Text>
        <NotificationChoicesForm
          // A pull-to-refresh starts the form again from what is stored.
          key={loaded}
          audience="shop"
          settings={data}
          canEdit={data.can_edit}
          phone={phoneToOffer(data.phone, data.contact_phone)}
          save={async (input) => {
            const saved = await api.sellerSetNotificationSettingsFrom("seller_app", shop.id, input);
            client.setQueryData(cached, saved);
            return saved;
          }}
          reload={async () => {
            const now = await api.sellerNotificationSettings(shop.id);
            client.setQueryData(cached, now);
            return now;
          }}
        />
      </Card>
    </Screen>
  );
}
