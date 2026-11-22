"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export interface NavItem {
  href: string;
  label: string;
  /** A small count next to the label, e.g. parcels waiting. Hidden when zero. */
  count?: number;
}

const isCurrent = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

function Item({ item, pathname, block }: { item: NavItem; pathname: string; block?: boolean }) {
  const current = isCurrent(item.href, pathname);
  return (
    <li>
      <Link
        href={item.href as Route}
        aria-current={current ? "page" : undefined}
        className={`flex min-h-11 items-center gap-2 whitespace-nowrap font-medium ${
          block
            ? `rounded-md border-l-4 px-3 ${current ? "border-brand bg-brand-soft text-ink" : "border-transparent text-ink-muted hover:bg-surface-muted hover:text-ink"}`
            : `border-b-2 px-3 ${current ? "border-brand text-ink" : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink"}`
        }`}
      >
        {item.label}
        {item.count ? (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-ink">
            {item.count}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * Section links for a back-office app. The current section is marked for sight
 * and for screen readers.
 *
 * With `menu`, for an app with many sections (the console has fifteen for an
 * administrator), every section is always reachable: on a wide screen the row
 * wraps onto a second line instead of scrolling out of sight, and below 1024 px
 * the sections fold into a "Secciones" button that opens them all. Both are
 * plain links and a native disclosure, so the keyboard reaches everything.
 */
export function NavLinks({ items, menu = false }: { items: NavItem[]; menu?: boolean }) {
  const pathname = usePathname();
  const disclosure = useRef<HTMLDetailsElement>(null);

  // A section chosen from the folded menu closes it.
  useEffect(() => {
    if (disclosure.current && pathname) disclosure.current.open = false;
  }, [pathname]);

  if (!menu) {
    return (
      <ul className="flex gap-1 text-sm">
        {items.map((item) => (
          <Item key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    );
  }

  const current = items.find((item) => isCurrent(item.href, pathname));
  return (
    <>
      <ul className="hidden flex-wrap gap-x-1 text-sm lg:flex">
        {items.map((item) => (
          <Item key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
      <details ref={disclosure} className="group pb-2 lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-border-strong px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>
            Secciones
            {current ? <span className="font-normal text-ink-muted">: {current.label}</span> : null}
          </span>
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <ul className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 md:grid-cols-3">
          {items.map((item) => (
            <Item key={item.href} item={item} pathname={pathname} block />
          ))}
        </ul>
      </details>
    </>
  );
}
