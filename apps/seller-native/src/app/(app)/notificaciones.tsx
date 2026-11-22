import { useQueryClient } from "@tanstack/react-query";
import { NotificationChoicesForm, phoneToOffer } from "@yuntera/expo-kit/account";
import { useApi, useSession } from "@yuntera/expo-kit/auth";
import { useApiQuery } from "@yuntera/expo-kit/data";
import { Card, ErrorState, LoadingState, Screen, Text } from "@yuntera/expo-kit/ui";
import { shopKey, useShop } from "@/lib/shops";

/**
 * The shop's notification settings (the seller centre's
 * /cuenta/notificaciones): how the shop is told of new and cancelled orders
 * and the review of its products, and its consent for commercial messages.
 * Only the owner or an administrator may change them; the others see them.
 */
export default function ShopNotificationsScreen() {
  const shop = useShop();
  const api = useApi();
  const { viewer } = useSession();
  const client = useQueryClient();
  const key = shopKey(shop.id, "notification-settings");
  const settings = useApiQuery(key, (a) => a.sellerNotificationSettings(shop.id), {
    personal: true,
  });

  if (settings.isPending) return <LoadingState />;
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  const data = settings.data;

  return (
    <Screen>
      <Text tint="muted">
        Cómo le avisamos de pedidos nuevos, pedidos cancelados y la revisión de sus productos.
      </Text>
      <Card testID="shop-notification-settings">
        <Text variant="small" tint="muted">
          Los correos van a <Text variant="smallStrong">{data.contact_email}</Text>, el correo de
          contacto de {shop.trade_name}.
        </Text>
        <NotificationChoicesForm
          audience="shop"
          settings={data}
          canEdit={data.can_edit}
          phone={phoneToOffer(data.phone, data.contact_phone)}
          save={async (input) => {
            const saved = await api.sellerSetNotificationSettings(shop.id, input);
            client.setQueryData(["user", viewer?.id ?? "anonymous", ...key], saved);
            return saved;
          }}
        />
      </Card>
    </Screen>
  );
}
