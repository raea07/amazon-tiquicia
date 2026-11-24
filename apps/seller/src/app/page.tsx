import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader, Stat } from "@yuntera/next-kit/shell";
import { Alert, Badge, buttonClass, formatPrice, Skeleton, touchLinkClass } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SELLER_HEALTH } from "@/lib/labels";
import { getOverview, requireShop } from "@/lib/shop";

export const metadata: Metadata = { title: "Resumen" };

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <div className="shell py-8">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Dashboard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const { shop } = await requireShop("/");
  const [overview, invitations] = await Promise.all([
    getOverview(shop.id),
    sessionApi().then((api) => api.myInvitations()),
  ]);
  const params = await searchParams;
  const welcome = params.bienvenida === "1";
  const joined = params.equipo === "1";
  const { counts, sales_30d: sales, seller } = overview;
  const health = SELLER_HEALTH[seller.health];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={seller.trade_name}
        actions={
          <Link href="/productos/nuevo" className={buttonClass()}>
            Publicar un producto
          </Link>
        }
      >
        Lo que necesita atender hoy y cómo va su tienda.
      </PageHeader>

      {welcome ? (
        <Alert tone="success" title="Recibimos su solicitud">
          Mientras verificamos sus datos puede ir preparando sus productos como borradores. Los
          envía a revisión cuando su tienda quede aprobada.
        </Alert>
      ) : null}
      {joined ? (
        <Alert tone="success" title="Ya es parte del equipo">
          Está trabajando en {seller.trade_name}. Si pertenece a varias tiendas, cambie de una a
          otra arriba, junto a su nombre.
        </Alert>
      ) : null}
      {invitations.length > 0 ? (
        <Alert tone="info" title="Tiene una invitación">
          {invitations.length === 1
            ? `${invitations[0]?.shop.trade_name} le invitó a su equipo.`
            : `${invitations.length} tiendas le invitaron a su equipo.`}{" "}
          <Link href="/invitaciones" className="font-semibold underline">
            Ver y responder
          </Link>
          .
        </Alert>
      ) : null}
      {seller.status === "pending" ? (
        <Alert tone="info" title="Su tienda está en revisión">
          Estamos verificando su identidad con los datos que nos dio. Normalmente toma uno o dos
          días hábiles y le avisamos por correo. Mientras tanto puede preparar productos como
          borradores; se envían a revisión cuando la tienda quede aprobada.
        </Alert>
      ) : null}
      {seller.status === "suspended" ? (
        <Alert tone="danger" title="Su tienda está suspendida">
          Sus productos no se muestran y no puede recibir pedidos nuevos. Le enviamos el motivo por
          correo; respóndanos ahí para resolverlo.
        </Alert>
      ) : null}

      <section aria-labelledby="atender">
        <h2 id="atender" className="text-xl font-bold">
          Por atender
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Pedidos por empacar"
            value={counts.to_pack}
            tone={counts.to_pack > 0 ? "warning" : undefined}
            hint={
              <Link href="/pedidos" className={touchLinkClass()}>
                Ver pedidos
              </Link>
            }
          />
          <Stat
            label="Productos sin existencias"
            value={counts.offers_out_of_stock}
            tone={counts.offers_out_of_stock > 0 ? "warning" : undefined}
            hint={
              <Link href="/inventario" className={touchLinkClass()}>
                Ver inventario
              </Link>
            }
          />
          <Stat
            label="Productos rechazados"
            value={counts.listings_rejected}
            tone={counts.listings_rejected > 0 ? "danger" : undefined}
            hint={
              <Link href="/productos" className={touchLinkClass()}>
                Ver el motivo
              </Link>
            }
          />
          <Stat label="Devoluciones abiertas" value={counts.open_returns} />
        </div>
      </section>

      <section aria-labelledby="ventas">
        <h2 id="ventas" className="text-xl font-bold">
          Últimos 30 días
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Ventas"
            value={formatPrice(sales.gross_minor)}
            hint="Precio pagado por los compradores"
          />
          <Stat label="Pedidos" value={sales.orders} hint={`${sales.units} unidades`} />
          <Stat
            label="Por cobrar"
            value={formatPrice(overview.payable_minor)}
            hint={
              <Link href="/pagos" className={touchLinkClass()}>
                Ver el detalle
              </Link>
            }
          />
          <Stat
            label="Productos publicados"
            value={counts.listings_active}
            hint={
              counts.listings_in_review > 0 ? `${counts.listings_in_review} en revisión` : undefined
            }
          />
        </div>
      </section>

      <section
        aria-labelledby="desempeno"
        className="rounded-lg border border-border bg-surface p-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="desempeno" className="text-xl font-bold">
            Desempeño
          </h2>
          <Badge tone={health.tone}>{health.label}</Badge>
          <span className="text-sm text-ink-muted">{seller.score} de 100</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Se calcula con sus últimos pedidos: despachos a tiempo, cancelaciones por falta de
          existencias, devoluciones por producto defectuoso o distinto, y reseñas. Un buen puntaje
          ayuda a que su oferta sea la destacada cuando varios vendedores ofrecen el mismo producto.
          Con pocos pedidos el puntaje se mantiene cerca del promedio: una sola mala semana no lo
          hunde.
        </p>
      </section>
    </div>
  );
}
