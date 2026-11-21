"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** A small count next to the label, e.g. parcels waiting. Hidden when zero. */
  count?: number;
}

/** Section links for a back-office app. The current section is marked for sight and for screen readers. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 text-sm">
      {items.map((item) => {
        const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href as Route}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 font-medium ${
                current
                  ? "border-brand text-ink"
                  : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink"
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
      })}
    </ul>
  );
}
