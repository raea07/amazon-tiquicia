import { buttonClass, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { deleteAddress, signOut } from "@/app/actions";
import { AddressForm } from "@/components/address-form";
import { ProfileForm } from "@/components/auth-forms";
import { getDistricts } from "@/lib/data";
import { requireViewer } from "@/lib/session";
import { sessionApi } from "@/lib/supabase";

export const metadata: Metadata = { title: "Su cuenta", robots: { index: false } };

export default function AccountPage() {
  return (
    <div className="shell py-8">
      <h1 className="text-3xl font-bold">Su cuenta</h1>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Account />
        </Suspense>
      </div>
    </div>
  );
}

async function Account() {
  const viewer = await requireViewer("/cuenta");
  const api = await sessionApi();
  const [profile, addresses, districts] = await Promise.all([
    api.myProfile(),
    api.myAddresses(),
    getDistricts(),
  ]);

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <div className="flex flex-col gap-8">
        <section aria-labelledby="datos" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="datos" className="text-xl font-bold">
            Sus datos
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">{profile?.email ?? viewer.email}</p>
          <ProfileForm
            fullName={profile?.full_name ?? ""}
            phone={profile?.phone?.replace("+506", "") ?? ""}
            marketingOptIn={profile?.marketing_opt_in ?? false}
          />
        </section>

        <section className="flex flex-wrap gap-3">
          <Link href="/pedidos" className={buttonClass({ variant: "secondary" })}>
            Ver sus pedidos
          </Link>
          <form action={signOut}>
            <button type="submit" className={buttonClass({ variant: "ghost" })}>
              Cerrar sesión
            </button>
          </form>
        </section>
      </div>

      <section id="direcciones" aria-labelledby="dir-titulo" className="scroll-mt-28">
        <h2 id="dir-titulo" className="text-xl font-bold">
          Direcciones de entrega
        </h2>
        {addresses.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {addresses.map((address) => (
              <li
                key={address.id}
                className="rounded-lg border border-border bg-surface p-4 text-sm"
              >
                <p className="font-semibold">
                  {address.label ? `${address.label} · ` : ""}
                  {address.recipient_name}
                  {address.is_default ? (
                    <span className="ml-2 font-normal text-ink-muted">(principal)</span>
                  ) : null}
                </p>
                <p className="mt-1 text-ink-muted">
                  {address.senas}. {address.district}, {address.canton}, {address.province}.
                </p>
                {address.plus_code ? (
                  <p className="mt-1 text-ink-muted">Código Plus {address.plus_code}</p>
                ) : null}
                {address.zone_active ? null : (
                  <p className="mt-1 font-medium text-warning">
                    Todavía no entregamos en esta zona.
                  </p>
                )}
                <form action={deleteAddress} className="mt-2">
                  <input type="hidden" name="addressId" value={address.id} />
                  <button type="submit" className={buttonClass({ variant: "ghost", size: "sm" })}>
                    Eliminar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-ink-muted">Todavía no ha guardado ninguna.</p>
        )}

        <details
          className="mt-5 rounded-lg border border-border bg-surface p-5"
          open={addresses.length === 0}
        >
          <summary className="cursor-pointer font-semibold text-link">
            Agregar una dirección
          </summary>
          <div className="mt-4">
            <AddressForm
              districts={districts}
              defaultName={profile?.full_name ?? viewer.name}
              returnTo="/cuenta"
            />
          </div>
        </details>
      </section>
    </div>
  );
}
