/**
 * What a person types: the vectors below are asserted on both sides, here and
 * in supabase/tests/140_invoicing.sql (private.invoice_clean_text and
 * private.invoice_email_valid), so what the database accepts at checkout is
 * exactly what the worker can write.
 */

import { describe, expect, it } from "vitest";
import { cleanText, HACIENDA_EMAIL } from "./codes.ts";

const CLEAN_VECTORS: Array<[string, string]> = [
  [" Ana\u0001  Mora Solís ", "Ana Mora Solís"],
  ["\u0001\u0001\u0001", ""],
  ['Ñandú & <b>"Hermanos"</b> S.A.', 'Ñandú & <b>"Hermanos"</b> S.A.'],
  ["línea uno\nlínea\tdos\r\n", "línea uno línea dos"],
  ["José Pérez", "José Pérez"],
  ["﻿Empresa S.A.￿", "Empresa S.A."],
];

const EMAIL_VECTORS: Array<[string, boolean]> = [
  ["ana.mora+factura@example.co.cr", true],
  ["o'neil@example.com", true],
  ["facturacion@yuntera.example", true],
  ["x<y@example.com", false],
  ["ana\u0001@example.com", false],
  ["a@b", false],
  ["a b@example.com", false],
  ["ana@example..com", false],
];

describe("what a person types", () => {
  it.each(CLEAN_VECTORS)("cleans %j to %j", (input, expected) => {
    expect(cleanText(input, 100)).toBe(expected);
  });

  it.each(EMAIL_VECTORS)("e-mail %j valid: %s", (email, valid) => {
    expect(HACIENDA_EMAIL.test(email)).toBe(valid);
  });
});
