/**
 * No copy of a status word outside this package (design system §4.3, "One
 * source"). The apps, the shared packages and the journeys ask
 * status-words.ts for every word on a status badge; this test reads their
 * source files and fails when a word comes back as a literal:
 *
 * 1. a status value written next to one of the module's words, as in
 *    `delivered: "Entregado"` or `failed: { label: "Pago rechazado" }`;
 * 2. a word the module replaced (today's words before the Carreta words)
 *    written as a whole string literal anywhere.
 *
 * Sentences that carry a status («Retirada: usted retiró esta solicitud.»)
 * and badges of conditions that are not a database status («Faltante»,
 * «Desactivada») are not status words and are not checked. A line that pairs
 * a status-like key with a word for something that is not a database status
 * (a closure, a refund panel, a queued action) ends with the marker
 * `// not a status word` and is skipped.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DERIVED_STATUS_WORDS, STATUS_KINDS, STATUS_VIEWERS, statusWordMap } from "./status-words";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where status words are shown or checked. */
const SCANNED = [
  /^apps\/[^/]+\/src\//,
  /^packages\/(?!core\/)[^/]+\/src\//,
  /^tools\/(e2e|native-e2e)\//,
];
const SOURCE = /\.(ts|tsx|cjs|mjs|js)$/;
const SKIPPED = /\.test\.|\/node_modules\//;

/**
 * Words the module replaced on 27 November 2026, unique enough to be found as
 * a whole literal. A screen that writes one of them again has a copy.
 */
const RETIRED_WORDS = [
  "En preparación",
  "De regreso",
  "Omitida",
  "Pago pendiente",
  "Pago fallido",
  "Pago anulado",
  "Reembolso parcial",
  "Por alistar",
  "Alistando",
  "En zona de despacho",
  "Recibiéndose",
  "En camino a la bodega",
  "En camino a su cuenta",
  "Aprobada: falta recibir el producto",
  "Producto recibido: falta reembolsar",
  "Enviado, sin confirmar",
  "Respuesta perdida: se verifica",
  "Preparándose para Hacienda",
  "Enviado, esperando a Hacienda",
  "Aceptado por Hacienda",
  "Rechazado por Hacienda",
  "Anulado con nota de crédito",
  "Detenido: vuelve a la zona de devoluciones",
  "Quitado de una ruta: espera otra",
  "Ningún paquete en camino: espera otra ruta",
];

/** Every Spanish word of the module, for every kind and viewer. */
function moduleWords(): Set<string> {
  const out = new Set<string>();
  for (const kind of STATUS_KINDS) {
    for (const viewer of STATUS_VIEWERS) {
      const words: Readonly<Record<string, string>> = statusWordMap(kind, viewer);
      for (const word of Object.values(words)) out.add(word);
    }
  }
  for (const entry of Object.values(DERIVED_STATUS_WORDS)) out.add(entry.es);
  return out;
}

/** Every database value the module has a word for. */
function statusValues(): Set<string> {
  const out = new Set<string>();
  for (const kind of STATUS_KINDS) {
    for (const value of Object.keys(statusWordMap(kind, "staff"))) out.add(value);
  }
  return out;
}

function scannedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => SOURCE.test(f) && !SKIPPED.test(f) && SCANNED.some((re) => re.test(f)));
}

const quoteRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The copies in one file's text, as "line: what". */
function copiesIn(text: string, words: Set<string>, values: Set<string>): string[] {
  const nextTo = new RegExp(
    `(?:^|[\\s{,(])["']?(${[...values].map(quoteRe).join("|")})["']?\\s*:\\s*(?:\\{\\s*label:\\s*)?["'\`]([^"'\`]+)["'\`]`,
  );
  const retired = new RegExp(`["'\`](${RETIRED_WORDS.map(quoteRe).join("|")})["'\`]`);
  const found: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trimEnd().endsWith("// not a status word")) return;
    const pair = line.match(nextTo);
    if (pair?.[2] && words.has(pair[2])) found.push(`${i + 1}: ${pair[1]} → «${pair[2]}»`);
    const old = line.match(retired);
    if (old) found.push(`${i + 1}: «${old[1]}» (a replaced word)`);
  });
  return found;
}

describe("status words have one source", () => {
  const words = moduleWords();
  const values = statusValues();

  it("finds the two kinds of copy it looks for", () => {
    expect(copiesIn(`  delivered: "Entregado",`, words, values)).toHaveLength(1);
    expect(
      copiesIn(`  failed: { label: "Pago rechazado", tone: "danger" },`, words, values),
    ).toHaveLength(1);
    expect(copiesIn(`<Badge>{"En preparación"}</Badge>`, words, values)).toHaveLength(1);
    expect(copiesIn(`  failed: "Escriba un correo válido.",`, words, values)).toEqual([]);
    expect(copiesIn(`  pending: "warning",`, words, values)).toEqual([]);
    expect(copiesIn(`  done: "Completado", // not a status word`, words, values)).toEqual([]);
  });

  it("no app, shared package or journey keeps a copy", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(100);
    const copies = files.flatMap((file) =>
      copiesIn(readFileSync(`${ROOT}${file}`, "utf8"), words, values).map((c) => `${file}:${c}`),
    );
    expect(copies).toEqual([]);
  });
});
