import { BackLink } from "@yuntera/next-kit/back-link";
import { NotificationSettingsForm } from "@yuntera/next-kit/client";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { saveShopNotificationSettings } from "@/app/notification-actions";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Notificaciones" };

export default function ShopNotificationsPage() {
  return (
    <div className="shell py-8">
      <BackLink href="/cuenta" className="mb-3">
        Cuenta
      </BackLink>
      <PageHeader title="Notificaciones">
        Cómo le avisamos de pedidos nuevos, pedidos cancelados y la revisión de sus productos.
      </PageHeader>
      <div className="mt-6 max-w-2xl rounded-lg border border-border bg-surface p-5">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Settings />
        </Suspense>
      </div>
    </div>
  );
}

async function Settings() {
  const { shop } = await requireShop("/cuenta/notificaciones");
  const settings = await (await sessionApi()).sellerNotificationSettings(shop.id);
  return (
    <>
      <p className="mb-5 text-sm text-ink-muted">
        Los correos van a <span className="font-semibold text-ink">{settings.contact_email}</span>,
        el correo de contacto de {shop.trade_name}.
      </p>
      <NotificationSettingsForm
        action={saveShopNotificationSettings}
        audience="shop"
        canEdit={settings.can_edit}
        settings={{
          ...settings,
          phone:
            settings.phone ??
            (/^\+506[5-8]/.test(settings.contact_phone ?? "") ? settings.contact_phone : null),
        }}
      />
    </>
  );
}
