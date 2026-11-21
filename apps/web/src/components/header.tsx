import { Skeleton, YunteraLogo } from "@yuntera/ui";
import type { Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cartUnits, readCart, readLocation } from "@/lib/cart";
import { getCategories, getDistricts } from "@/lib/data";
import { getViewer } from "@/lib/session";

/**
 * The header is part of the prerendered shell: logo, search and categories
 * arrive instantly. The three things that depend on who is looking — delivery
 * district, account, cart — are small islands that stream in behind fallbacks
 * of the same size, so nothing shifts when they arrive.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="shell flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
        <Link href="/" aria-label="Yuntera, inicio" className="rounded-md">
          <YunteraLogo size={30} />
        </Link>

        {/* biome-ignore lint/a11y/useSemanticElements: role="search" on a form is announced by older screen readers that do not know the <search> element */}
        <form
          action="/buscar"
          role="search"
          className="order-last flex w-full gap-2 md:order-none md:flex-1"
        >
          <label htmlFor="q" className="sr-only">
            Buscar productos
          </label>
          <input
            id="q"
            name="q"
            type="search"
            placeholder="¿Qué ocupa?"
            autoComplete="off"
            enterKeyHint="search"
            className="min-h-11 w-full rounded-md border border-border-strong bg-surface px-4 text-base placeholder:text-anil-500"
          />
          <button
            type="submit"
            className="min-h-11 rounded-md bg-brand px-4 font-semibold text-on-brand hover:bg-brand-hover"
          >
            Buscar
          </button>
        </form>

        <nav aria-label="Su cuenta" className="ml-auto flex items-center gap-1 text-sm md:ml-0">
          <Suspense fallback={<Skeleton className="h-11 w-36" />}>
            <LocationLink />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-11 w-24" />}>
            <AccountLink />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-11 w-24" />}>
            <CartLink />
          </Suspense>
        </nav>
      </div>

      <CategoryBar />
    </header>
  );
}

const navItem =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 font-medium text-ink hover:bg-surface-muted";

async function LocationLink() {
  const { postalCode, chosen } = await readLocation();
  const districts = await getDistricts();
  const place = districts.find((d) => d.postal_code === postalCode);
  return (
    <Link href="/zona" className={navItem}>
      <PinIcon />
      <span>
        <span className="sr-only">Entregar en </span>
        {chosen && place ? place.district : "Elija su zona"}
      </span>
    </Link>
  );
}

async function AccountLink() {
  const viewer = await getViewer();
  return viewer ? (
    <Link href="/cuenta" className={navItem}>
      {viewer.name?.split(" ")[0] ?? "Mi cuenta"}
    </Link>
  ) : (
    <Link href="/ingresar" className={navItem}>
      Ingresar
    </Link>
  );
}

async function CartLink() {
  const units = cartUnits(await readCart());
  return (
    <Link href="/carrito" className={navItem}>
      Carrito
      <span
        className={`inline-flex min-w-6 justify-center rounded-full px-1.5 text-xs font-bold ${
          units > 0 ? "bg-brand text-on-brand" : "bg-arena-200 text-ink-muted"
        }`}
      >
        {units}
        <span className="sr-only"> {units === 1 ? "producto" : "productos"}</span>
      </span>
    </Link>
  );
}

async function CategoryBar() {
  const categories = (await getCategories()).filter((c) => !c.parent_slug && c.product_count > 0);
  return (
    <nav aria-label="Categorías" className="border-t border-border">
      <ul className="shell flex gap-1 overflow-x-auto py-1 text-sm">
        {categories.map((category) => (
          <li key={category.slug} className="shrink-0">
            <Link
              href={`/c/${category.slug}` as Route}
              className="inline-flex min-h-10 items-center rounded-md px-3 text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              {category.name_es}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 text-brand" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 1.5a6 6 0 0 0-6 6c0 4.2 5.1 10.2 5.4 10.5a.8.8 0 0 0 1.2 0C10.9 17.7 16 11.7 16 7.5a6 6 0 0 0-6-6Zm0 8.3a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z"
      />
    </svg>
  );
}
