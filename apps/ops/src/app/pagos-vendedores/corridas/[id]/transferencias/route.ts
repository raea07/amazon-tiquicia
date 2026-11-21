import { transferListCsv } from "@yuntera/core";
import { ApiError } from "@yuntera/db";
import { sessionApi, signInPath } from "@yuntera/next-kit/server";
import { canSee, currentStaff } from "@/lib/staff";

/**
 * The list of transfers still to make in a payout run, as a CSV file for
 * finance to take to the bank. It holds whole account numbers, so:
 *
 *   - only a signed-in member of finance (or an administrator) gets it; the
 *     database checks the same thing again when the run is read;
 *   - it is never cached, here or anywhere on the way to the browser.
 */

const NEVER_CACHED = { "Cache-Control": "private, no-store, max-age=0" };

const refuse = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: { ...NEVER_CACHED, "Content-Type": "text/plain; charset=utf-8" },
  });

export async function GET(
  _request: Request,
  context: RouteContext<"/pagos-vendedores/corridas/[id]/transferencias">,
) {
  const { id } = await context.params;
  const staff = await currentStaff();
  if (!staff) {
    return new Response(null, {
      status: 307,
      headers: { ...NEVER_CACHED, Location: signInPath(`/pagos-vendedores/corridas/${id}`) },
    });
  }
  if (!canSee(staff.staff_role, ["finance"])) {
    return refuse(403, "Su cuenta no tiene permiso para descargar esta lista.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return refuse(404, "No encontramos esa corrida de pagos.");

  let run: Awaited<ReturnType<Awaited<ReturnType<typeof sessionApi>>["opsPayoutRun"]>>;
  try {
    run = await (await sessionApi()).opsPayoutRun(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "payout_run_not_found") {
      return refuse(404, error.userMessage("es-CR"));
    }
    if (error instanceof ApiError && error.code === "forbidden") {
      return refuse(403, error.userMessage("es-CR"));
    }
    console.error(error);
    return refuse(500, "No pudimos preparar la lista. Inténtelo de nuevo en un momento.");
  }

  const csv = transferListCsv(
    run.payouts
      .filter((payout) => payout.status === "scheduled")
      .map((payout) => ({
        iban: payout.iban,
        holderName: payout.holder_name,
        idNumber: payout.id_number,
        amountMinor: payout.amount_minor,
        reference: payout.reference,
        shop: payout.trade_name,
      })),
  );

  // The byte-order mark makes spreadsheet programs read the accents correctly.
  return new Response(`﻿${csv}`, {
    headers: {
      ...NEVER_CACHED,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transferencias-${run.run.code}.csv"`,
    },
  });
}
