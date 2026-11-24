import { BackLink } from "@yuntera/next-kit/back-link";
import { NotificationSettingsForm } from "@yuntera/next-kit/client";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { saveNotificationSettings } from "@/app/notification-actions";
import { requireViewer } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

export const metadata: Metadata = { title: "Notificaciones", robots: { index: false } };

export default function NotificationsPage() {
  return (
    <div className="shell py-8">
      <BackLink href="/cuenta">Su cuenta</BackLink>
      <h1 className="mt-3 text-3xl font-bold">Notificaciones</h1>
      <p className="mt-1 max-w-2xl text-ink-muted">
        Elija por dónde quiere que le avisemos de sus pedidos. Nunca le enviaremos su código de
        entrega, su dirección ni datos de pago: para eso, abra la página del pedido.
      </p>
      <div className="mt-6 max-w-2xl rounded-lg border border-border bg-surface p-5">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Settings />
        </Suspense>
      </div>
    </div>
  );
}

async function Settings() {
  await requireViewer("/cuenta/notificaciones");
  const settings = await (await sessionApi()).myNotificationSettings();
  return (
    <NotificationSettingsForm
      action={saveNotificationSettings}
      audience="shopper"
      settings={{
        ...settings,
        // Offer the profile's phone when it is a mobile; a landline cannot get WhatsApp.
        phone:
          settings.phone ??
          (/^\+506[5-8]/.test(settings.profile_phone ?? "") ? settings.profile_phone : null),
      }}
    />
  );
}
