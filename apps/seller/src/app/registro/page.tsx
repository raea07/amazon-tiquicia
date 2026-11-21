import { SignUpForm } from "@yuntera/next-kit/client";
import { getRoles, getViewer, sessionApi } from "@yuntera/next-kit/server";
import { Alert, buttonClass, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RegisterShopForm } from "@/components/forms";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Registre su tienda" };

const SHOP_URL = process.env.NEXT_PUBLIC_SHOP_URL ?? "http://localhost:3000";

export default function RegisterPage() {
  return (
    <div className="shell py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold">Venda en Yuntera</h1>
        <p className="mt-2 text-ink-muted">
          Publique sus productos y nosotros nos encargamos del cobro y de la entrega en el Gran Área
          Metropolitana. Sin mensualidad: solo paga una comisión cuando vende.
        </p>
        <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["1. Registre su tienda", "Con los datos con que está inscrito en Hacienda."],
            ["2. Verificamos su identidad", "Normalmente en uno o dos días hábiles."],
            ["3. Publique y venda", "Usted pone el precio. Ve cada cargo antes de publicar."],
          ].map(([title, text]) => (
            <li key={title} className="rounded-lg border border-border bg-surface p-4">
              <p className="font-semibold">{title}</p>
              <p className="mt-1 text-ink-muted">{text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Step />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function Step() {
  const viewer = await getViewer();
  if (!viewer) {
    return (
      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-xl font-bold">Primero, su cuenta</h2>
        <p className="mt-1 mb-5 text-sm text-ink-muted">
          Si ya compra en Yuntera,{" "}
          <Link
            href="/ingresar?siguiente=%2Fregistro"
            className="font-semibold text-link underline"
          >
            ingrese con esa cuenta
          </Link>
          . Si no, créela aquí.
        </p>
        <div className="max-w-md">
          <SignUpForm action={signUp} returnTo="/registro" legalBase={SHOP_URL} />
        </div>
      </section>
    );
  }

  const [roles, invitations] = await Promise.all([
    getRoles(),
    sessionApi().then((api) => api.myInvitations()),
  ]);
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      {invitations.length > 0 ? (
        <Alert tone="info" className="mb-5" title="Le invitaron a una tienda">
          {invitations.length === 1
            ? `${invitations[0]?.shop.trade_name} le invitó a su equipo.`
            : `${invitations.length} tiendas le invitaron a su equipo.`}{" "}
          Si va a trabajar en una tienda que ya existe, no la registre de nuevo:{" "}
          <Link href="/invitaciones" className="font-semibold underline">
            vea la invitación
          </Link>
          .
        </Alert>
      ) : null}
      {roles && roles.sellers.length > 0 ? (
        <Alert tone="info" className="mb-5" title="Ya tiene una tienda registrada">
          Puede registrar otra con una identificación distinta, o{" "}
          <Link href="/" className="underline">
            volver al resumen
          </Link>
          .
        </Alert>
      ) : null}
      <h2 className="text-xl font-bold">Datos de la tienda</h2>
      <div className="mt-5">
        <RegisterShopForm defaultEmail={viewer.email} />
      </div>
      <p className="mt-5 text-sm text-ink-muted">
        ¿Dudas sobre comisiones o requisitos?{" "}
        <a href={`${SHOP_URL}/ayuda`} className={buttonClass({ variant: "ghost", size: "sm" })}>
          Ver la ayuda
        </a>
      </p>
    </section>
  );
}
