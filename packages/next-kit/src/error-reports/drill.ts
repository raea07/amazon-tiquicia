import { connection } from "next/server";
import { isLocalRun } from "../guard";

/**
 * The text of the error the drill throws: made-up personal data of every kind
 * the reports must never carry, so the error-reports journey can check, in
 * what reached the stand-in tracker, that none of it arrived.
 */
export const DRILL_MESSAGE =
  "Prueba de errores: pedido de ana.prueba@example.com, teléfono +506 8888-1234, " +
  "cédula 1-0234-0567, código de entrega 4821, " +
  "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcnVlYmEifQ.c2lnbmF0dXJh";

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
