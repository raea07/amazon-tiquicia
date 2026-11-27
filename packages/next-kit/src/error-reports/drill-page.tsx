import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isLocalRun } from "../guard";
import { FailsInBrowser } from "./drill-client";
import { DRILL_MESSAGE } from "./drill-message";

/**
 * A page that fails on purpose, for the error-reports journey (each website
 * serves it at /prueba-de-errores): it shows the website's error page, and
 * the server reports the error. On any deployment it is a plain 404, decided
 * before anything is sent, like an address that does not exist.
 *
 * - `?en=navegador`: fails while rendering in the browser instead, so the
 *   error page reports it from there.
 * - `?una-vez=<mark>`: fails the first time a mark is seen and then shows the
 *   page, so the journey can check that "Intentar de nuevo" fetches the page
 *   again from the server.
 */
export async function drillMetadata(): Promise<Metadata> {
  await connection();
  if (!isLocalRun(process.env)) notFound();
  return { title: "Prueba de errores", robots: { index: false } };
}

type Query = Promise<Record<string, string | string[] | undefined>>;

/** The marks already failed once (this server process only; a handful at most). */
const failedOnce = new Set<string>();

async function Fails({ searchParams }: { searchParams: Query }) {
  await connection();
  if (!isLocalRun(process.env)) notFound();
  const query = await searchParams;
  if (query.en === "navegador") return <FailsInBrowser />;
  const mark = typeof query["una-vez"] === "string" ? query["una-vez"].slice(0, 40) : null;
  if (mark && failedOnce.has(mark)) {
    return (
      <div className="shell py-16">
        <p>La página volvió a cargar.</p>
      </div>
    );
  }
  if (mark) {
    if (failedOnce.size > 100) failedOnce.clear();
    failedOnce.add(mark);
  }
  // A different ending each time, so the SDK's duplicate filter (which drops
  // an error identical to the one before) lets every drill through.
  throw new Error(DRILL_MESSAGE.concat(" (vez ", Date.now().toString(36), ")"));
}

export function DrillPage({ searchParams }: { searchParams: Query }) {
  return (
    <Suspense>
      <Fails searchParams={searchParams} />
    </Suspense>
  );
}
