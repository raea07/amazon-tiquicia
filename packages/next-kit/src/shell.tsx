import type { AppId } from "@yuntera/brand";
import { YunteraLogo } from "@yuntera/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame every back-office app shares: skip link, a header with the app's
 * lockup, a slot for who is signed in, a row of sections, then the page.
 *
 * `account` and `nav` usually depend on the signed-in person, so pass them
 * already wrapped in <Suspense>; the frame itself is static.
 */
export function AppShell({
  app,
  account,
  nav,
  children,
}: {
  app: AppId;
  account?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-md"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="shell flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <Link href="/" className="rounded-md">
            <YunteraLogo app={app} size={26} />
          </Link>
          <div className="flex min-h-11 items-center gap-3 text-sm">{account}</div>
        </div>
        {nav ? (
          <nav aria-label="Secciones" className="shell overflow-x-auto">
            {nav}
          </nav>
        ) : null}
      </header>
      <main id="contenido" className="flex-1">
        {children}
      </main>
    </>
  );
}

/** A page's title row: heading, optional explanation, optional actions on the right. */
export function PageHeader({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        {children ? <p className="mt-1 max-w-2xl text-ink-muted">{children}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** One number with its label, for the top of a dashboard. */
export function Stat({
  label,
  value,
  hint,
  tone,
  "data-testid": testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "warning" | "danger";
  /** A stable hook for the browser journeys (SISTEMA §20.5). */
  "data-testid"?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`rounded-lg border bg-surface p-4 ${
        tone === "danger"
          ? "border-danger"
          : tone === "warning"
            ? "border-warning"
            : "border-border"
      }`}
    >
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A data table that stays usable on a phone: it scrolls sideways inside its
 * own frame instead of pushing the page wider than the screen.
 */
export function DataTable({
  caption,
  head,
  children,
}: {
  /** Read by screen readers; not shown. */
  caption: string;
  head: string[];
  children: ReactNode;
}) {
  return (
    // `relative` keeps absolutely positioned content (such as screen-reader-only
    // text) inside the scroller instead of widening the page.
    <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
            {head.map((label) => (
              <th key={label} scope="col" className="px-4 py-3 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:not(:last-child)]:border-b [&>tr]:border-border [&_td]:px-4 [&_td]:py-3 [&_td]:align-top">
          {children}
        </tbody>
      </table>
    </div>
  );
}
