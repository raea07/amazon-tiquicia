import { connection } from "next/server";
import { isLocalRun } from "../guard";
import { DRILL_MESSAGE } from "./drill-message";

/**
 * A route that fails on purpose, for the error-reports journey (each website
 * serves it at /api/prueba-de-errores). It exists only on this machine and in
 * the lanes of tools/dev/stack.sh: on any deployment it answers 404, exactly
 * like an address that does not exist.
 */
export async function errorDrill(): Promise<Response> {
  // Read at request time, never while the website is being built.
  await connection();
  if (!isLocalRun(process.env)) return new Response(null, { status: 404 });
  throw new Error(DRILL_MESSAGE);
}
