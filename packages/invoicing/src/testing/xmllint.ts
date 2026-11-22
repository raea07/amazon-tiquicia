/**
 * The official schemas, checked with libxml2's xmllint (the tool the research
 * note validated its samples with). Tests only; Node only. xmllint must be
 * installed (Debian/Ubuntu: libxml2-utils); the tests fail, not skip, without it.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DocumentType } from "../codes.ts";

const schemas = fileURLToPath(new URL("../../schemas/", import.meta.url));

export const SCHEMA: Record<DocumentType | "mensajeHacienda", string> = {
  "01": `${schemas}v4.4/factura/FacturaElectronica_V4.4.xsd`,
  "03": `${schemas}v4.4/nota-credito/NotaCreditoElectronica_V4.4.xsd`,
  "04": `${schemas}v4.4/tiquete/TiqueteElectronico_V4.4.xsd`,
  mensajeHacienda: `${schemas}v4.4/mensaje-hacienda/MensajeHacienda_V4.4.xsd`,
};

function xmllint(args: string[], input: string) {
  const run = spawnSync("xmllint", args, { input, encoding: "utf8" });
  if (run.error) {
    throw new Error(
      `xmllint is needed to check the official schemas (apt-get install libxml2-utils): ${run.error.message}`,
    );
  }
  return run;
}

/** Validates against the schema; returns xmllint's complaints, or [] when it validates. */
export function schemaErrors(xml: string, type: keyof typeof SCHEMA): string[] {
  const run = xmllint(["--noout", "--nonet", "--schema", SCHEMA[type], "-"], xml);
  if (run.status === 0) return [];
  return run.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith("fails to validate"));
}

/** Exclusive canonical form of a whole document, by libxml2 (an independent implementation). */
export function exclusiveC14n(xml: string): string {
  const run = xmllint(["--nonet", "--exc-c14n", "-"], xml);
  if (run.status !== 0) throw new Error(`xmllint --exc-c14n failed: ${run.stderr}`);
  return run.stdout;
}
