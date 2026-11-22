"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * Says so while a product page still shows the date and shipping price of the
 * zone the shopper just left.
 *
 * Choosing a zone goes back to the product page. The framework shows the copy
 * of that page it kept from before at once, and the new date and price only
 * when the server's answer arrives, which on a slow connection takes seconds.
 * The zone form writes the postal code it is sending into this tab's session
 * storage; until the page on screen was drawn for that code, the old values are
 * dimmed, marked busy, and a line says an update is coming.
 */

export const PENDING_ZONE_KEY = "yt-zona-pendiente";
/** After this long the page stops waiting and shows what it has. */
const GIVE_UP_MS = 10_000;

export const ZONE_UPDATING = "Actualizando la fecha de entrega y el envío para su zona…";

/** Called by the zone form as it sends the new postal code. */
export function markZonePending(postalCode: string): void {
  try {
    sessionStorage.setItem(PENDING_ZONE_KEY, JSON.stringify({ postalCode, at: Date.now() }));
  } catch {
    // Storage may be unavailable (private mode): the page simply updates without the note.
  }
}

function pendingZone(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ZONE_KEY);
    if (!raw) return null;
    const { postalCode, at } = JSON.parse(raw) as { postalCode?: unknown; at?: unknown };
    if (typeof postalCode !== "string" || typeof at !== "number") return null;
    return Date.now() - at < GIVE_UP_MS ? postalCode : null;
  } catch {
    return null;
  }
}

export function ZoneFreshness({
  postalCode,
  children,
}: {
  /** The postal code this copy of the page was drawn for. */
  postalCode: string;
  children: ReactNode;
}) {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const pending = pendingZone();
    if (pending === null || pending === postalCode) {
      try {
        sessionStorage.removeItem(PENDING_ZONE_KEY);
      } catch {
        // Nothing to clear.
      }
      setWaiting(false);
      return;
    }
    setWaiting(true);
    const stop = setTimeout(() => setWaiting(false), GIVE_UP_MS);
    return () => clearTimeout(stop);
  }, [postalCode]);

  return (
    <div aria-busy={waiting || undefined}>
      {waiting ? (
        <p
          role="status"
          className="mb-3 flex items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-sm font-semibold text-ink"
        >
          <span
            aria-hidden="true"
            className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {ZONE_UPDATING}
        </p>
      ) : null}
      <div className={waiting ? "opacity-50 transition-opacity" : undefined}>{children}</div>
    </div>
  );
}
