import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isLocalRun } from "../guard";
import { DRILL_MESSAGE } from "./drill-message";

/**
 * A page that fails on purpose, for the error-reports journey (each website
 * serves it at /prueba-de-errores): it shows the website's error page, and
 * the server reports the error. On any deployment it is a plain 404, decided
 * before anything is sent, like an address that does not exist.
 */
export async function drillMetadata(): Promise<Metadata> {
  await connection();
  if (!isLocalRun(process.env)) notFound();
  return { title: "Prueba de errores", robots: { index: false } };
}

async function Fails(): Promise<never> {
  await connection();
  if (!isLocalRun(process.env)) notFound();
  // A different ending each time, so the SDK's duplicate filter (which drops
  // an error identical to the one before) lets every drill through.
  throw new Error(DRILL_MESSAGE.concat(" (vez ", Date.now().toString(36), ")"));
}

export function DrillPage() {
  return (
    <Suspense>
      <Fails />
    </Suspense>
  );
}
