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

/**
 * The text of the first element at a path of local names (namespaces
 * ignored), as libxml2 parses it: character references resolved, no DTD
 * loaded, nothing fetched (--nonet). Null when there is no such element.
 */
export function textAt(xml: string, ...path: string[]): string | null {
  const xpath = `/${path.map((name) => `/*[local-name()='${name}']`).join("")}`;
  const count = xmllint(["--nonet", "--xpath", `count(${xpath})`, "-"], xml);
  if (count.status !== 0 || Number(count.stdout.trim()) === 0) return null;
  const run = xmllint(["--nonet", "--xpath", `string(${xpath}[1])`, "-"], xml);
  if (run.status !== 0) throw new Error(`xmllint --xpath failed: ${run.stderr}`);
  // xmllint ends what it prints with a newline of its own.
  return run.stdout.replace(/\n$/, "");
}

/** Whether libxml2 reads it as well-formed XML (no DTD loaded, nothing fetched). */
export function wellFormed(xml: string): boolean {
  return xmllint(["--noout", "--nonet", "-"], xml).status === 0;
}
