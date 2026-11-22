import { SHOP_DESCRIPTION_MAX } from "@yuntera/core";
import type { SellerShopFront } from "@yuntera/db";
import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { ShopLogo } from "@yuntera/next-kit/shop-logo";
import { Alert, Badge, formatDate, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoUploader, RemoveLogoForm, WithdrawLogoForm } from "@/components/logo-manager";
import { ShopDescriptionForm } from "@/components/seller-listing-forms";
import { WithdrawShopChangeForm } from "@/components/shop-change-forms";
import { requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Su tienda en Yuntera" };

const SHOP_URL = process.env.NEXT_PUBLIC_SHOP_URL ?? "";

/**
 * What shoppers see of the shop: its page, its description and its logo.
 * Both change only after staff review them; until then the shop shows what it
 * had. The description is plain text: whatever is typed is shown as typed.
 */
export default function ShopFrontPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Su tienda en Yuntera">
        Lo que los compradores ven de su tienda: el nombre, el logotipo y la descripción. Los
        cambios los revisamos antes de mostrarlos.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Front />
        </Suspense>
      </div>
    </div>
  );
}

const day = (value: string) =>
  formatDate(value, { day: "numeric", month: "long", year: "numeric" });

async function Front() {
  const { shop } = await requireShop("/tienda");
  const front = await (await sessionApi()).sellerShopFront(shop.id);
  const publicPage = `${SHOP_URL}/tienda/${front.slug}`;

  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <section
        aria-labelledby="vista"
        className="rounded-lg border border-border bg-surface p-5 lg:col-span-2"
      >
        <h2 id="vista" className="text-lg font-bold">
          Así la ven los compradores
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <ShopLogo logo={front.logo} name={front.trade_name} size={72} />
          <div className="min-w-0">
            <p className="text-xl font-bold break-words">{front.trade_name}</p>
            {front.status === "active" ? (
              <a
                href={publicPage}
                className="inline-flex min-h-11 items-center text-link underline"
              >
                Ver la página de su tienda
              </a>
            ) : (
              <p className="text-sm text-ink-muted">
                Su tienda tendrá página en cuanto esté activa.
              </p>
            )}
          </div>
        </div>
        {front.description ? (
          <p
            className="mt-4 whitespace-pre-line break-words text-ink"
            data-testid="shop-description"
          >
            {front.description}
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Todavía no tiene descripción.</p>
        )}
      </section>

      <section
        aria-labelledby="descripcion"
        className="rounded-lg border border-border bg-surface p-5"
      >
        <h2 id="descripcion" className="text-lg font-bold">
          Descripción
        </h2>
        <DescriptionStatus front={front} />
        {front.can_edit ? (
          <div className="mt-4">
            <ShopDescriptionForm
              key={front.description_request?.id ?? "none"}
              current={
                front.description_request?.status === "pending" ||
                front.description_request?.status === "rejected"
                  ? (front.description_request.proposed.description ?? "")
                  : front.description
              }
              max={SHOP_DESCRIPTION_MAX}
            />
          </div>
        ) : (
          <p className="mt-3 text-sm">
            Solo la persona dueña o administradora de la tienda puede cambiar la descripción.
          </p>
        )}
      </section>

      <section
        aria-labelledby="logotipo"
        className="rounded-lg border border-border bg-surface p-5"
      >
        <h2 id="logotipo" className="text-lg font-bold">
          Logotipo
        </h2>
        <LogoStatus front={front} />
        {front.can_edit ? (
          <div className="mt-4 flex flex-col gap-5">
            <LogoUploader hasWaiting={front.logo_waiting !== null} />
            {front.logo_waiting?.state === "pending" ? <WithdrawLogoForm /> : null}
            {front.logo ? <RemoveLogoForm /> : null}
          </div>
        ) : (
          <p className="mt-3 text-sm">
            Solo la persona dueña o administradora de la tienda puede cambiar el logotipo.
          </p>
        )}
      </section>
    </div>
  );
}

function DescriptionStatus({ front }: { front: SellerShopFront }) {
  const request = front.description_request;
  if (!request) return null;
  if (request.status === "pending") {
    // An empty proposal asks to remove the description.
    const removal = !request.proposed.description;
    return (
      <div className="mt-3">
        <Alert
          tone="info"
          title={
            removal
              ? "Pidió quitar la descripción; está en revisión"
              : "Descripción nueva en revisión"
          }
        >
          <span className="block">
            {removal
              ? `Lo pidió el ${day(request.requested_at)}. Mientras lo revisamos, la tienda sigue mostrando la descripción que tiene.`
              : `La envió el ${day(request.requested_at)}. Mientras la revisamos, la tienda muestra la que ya tenía.`}
          </span>
          {front.can_edit ? (
            <div className="mt-2">
              <WithdrawShopChangeForm requestId={request.id} />
            </div>
          ) : null}
        </Alert>
      </div>
    );
  }
  if (request.status === "rejected") {
    return (
      <div className="mt-3">
        <Alert tone="danger" title="No aprobamos la última descripción">
          <span className="block">Motivo: {request.note}</span>
          <span className="mt-1 block">
            La tienda sigue mostrando la anterior. Corríjala abajo y envíela de nuevo.
          </span>
        </Alert>
      </div>
    );
  }
  return request.decided_at ? (
    <p className="mt-3 text-sm text-ink-muted">
      Última descripción aprobada el {day(request.decided_at)}.
    </p>
  ) : null;
}

function LogoStatus({ front }: { front: SellerShopFront }) {
  const waiting = front.logo_waiting;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {waiting ? (
        <Alert
          tone="info"
          title={waiting.state === "pending" ? "Logotipo en revisión" : "Logotipo aprobado"}
        >
          <span className="flex flex-wrap items-center gap-3">
            {/* The waiting copy, read under the seller's own session (app/fotos). */}
            {/* biome-ignore lint/performance/noImgElement: a private file, served by this app */}
            <img
              src={`/fotos/${waiting.template.replace("{w}", "400")}`}
              alt="El logotipo que envió"
              width={56}
              height={56}
              className="size-14 rounded-md border border-border bg-surface object-contain"
            />
            <span>
              {waiting.state === "pending"
                ? "Lo revisamos normalmente en un día hábil. Mientras tanto la tienda muestra el que tenía."
                : "Lo estamos publicando; en unos minutos aparece en la tienda."}
            </span>
          </span>
        </Alert>
      ) : null}
      {front.logo_rejected ? (
        <Alert tone="danger" title="No aprobamos el último logotipo">
          Motivo: {front.logo_rejected.rejection_reason}
        </Alert>
      ) : null}
      {front.logo ? (
        <p className="text-sm">
          <Badge tone="success">Publicado</Badge>{" "}
          <span className="text-ink-muted">Su logotipo actual se ve arriba.</span>
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          Sin logotipo, la tienda muestra la inicial de su nombre.
        </p>
      )}
    </div>
  );
}
