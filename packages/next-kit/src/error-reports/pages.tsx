"use client";

/**
 * What a person sees when a page breaks, the same in the four websites.
 *
 * `ErrorScreen` is the body of each website's error pages: `app/error.tsx`
 * (a page failed and the website around it still works) and
 * `app/global-error.tsx` (the website's frame itself failed, so the page
 * brings its own <html> and <body>). It says that something failed, that the
 * team was told (only once the report was handed to the tracker: see
 * `reportError`), and what to do next. It never shows a code or a stack.
 *
 * "Intentar de nuevo" calls the framework's `retry`, which fetches the page
 * from the server again and renders it, so a passing failure (the database
 * briefly out of reach) is fixed by the button and not only by reloading.
 */
import type { AppId } from "@yuntera/brand";
import { Button, buttonClass, EmptyState, YunteraLogo } from "@yuntera/ui";
import { type ReactNode, useEffect, useState } from "react";
import { fontClassName } from "../fonts";
import { reportError } from "./client";

/**
 * The page `app/global-error.tsx` shows: it replaces the website's own frame,
 * so it brings the document, the fonts and, through the website's import of
 * its globals.css, the styles. The frame's metadata does not apply here, so
 * it also brings the website's lockup and its theme colour.
 */
export function GlobalErrorDocument({
  error,
  retry,
  advice,
  app,
  themeColor,
}: {
  error: unknown;
  retry?: () => void;
  advice: ReactNode;
  /** The website's lockup (packages/brand), as its frame draws it. */
  app: AppId;
  /** The website's theme colour (`light[appThemeColor.<app>]`), as its layout sets it. */
  themeColor: string;
}) {
  const told = useReportError(error);
  return (
    <html lang="es-CR" className={fontClassName}>
      <body className="flex min-h-dvh flex-col antialiased">
        <meta name="theme-color" content={themeColor} />
        <header className="border-b border-border bg-surface">
          <div className="shell py-3">
            <YunteraLogo app={app} size={26} />
          </div>
        </header>
        <main id="contenido" className="flex-1">
          <ErrorScreen advice={advice} onRetry={retry} told={told} />
        </main>
      </body>
    </html>
  );
}

/**
 * Reports an error an error page caught, once per error, and says whether
 * the report was handed to the tracker (false until then, and when off).
 */
export function useReportError(error: unknown): boolean {
  const [told, setTold] = useState(false);
  useEffect(() => {
    let current = true;
    setTold(false);
    void reportError(error).then((sent) => {
      if (current) setTold(sent);
    });
    return () => {
      current = false;
    };
  }, [error]);
  return told;
}

export const ERROR_TITLE = "Algo falló de nuestro lado";
export const TEAM_TOLD = "Ya le avisamos al equipo de Yuntera.";

export function ErrorScreen({
  advice,
  onRetry,
  home = true,
  told = false,
}: {
  /** What to do next, in this website's words. */
  advice: ReactNode;
  onRetry?: () => void;
  /** Offer a way back to the start (a plain link, which works even when the website's frame did not). */
  home?: boolean;
  /** Whether the report reached the tracker's SDK (useReportError). */
  told?: boolean;
}) {
  return (
    <div className="shell py-16">
      <EmptyState
        title={ERROR_TITLE}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            {onRetry ? <Button onClick={onRetry}>Intentar de nuevo</Button> : null}
            {home ? (
              // A plain link on purpose: it reloads the website from the start.
              <a href="/" className={buttonClass({ variant: "secondary" })}>
                Volver al inicio
              </a>
            ) : null}
          </div>
        }
      >
        {told ? `No es culpa suya. ${TEAM_TOLD} ` : "No es culpa suya. "}
        {advice}
      </EmptyState>
    </div>
  );
}
