/**
 * The comparison of scanned codes exists twice: here and in the database,
 * which refuses a pick of the wrong product (supabase/migrations/
 * 20261121083200_followups.sql). supabase/tests/125_followups.sql runs the
 * table of cases between its `scan_code_cases` markers through the SQL; this
 * file runs the same table through the TypeScript, and fails if the two
 * tables differ.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CR_BOUNDS } from "./cr/geo";
import { cleanScan, codeKeys, matchesTarget } from "./scan-codes";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sqlTest = readFileSync(`${root}supabase/tests/125_followups.sql`, "utf8");
const migration = readdirSync(`${root}supabase/migrations`)
  .filter((file) => file.endsWith("_followups.sql"))
  .map((file) => readFileSync(`${root}supabase/migrations/${file}`, "utf8"))
  .join("\n");

/** [what arrived, the comparable keys] */
const CASES: Array<[string, string[]]> = [
  ["  yt-ab12cd34  ", ["YT-AB12CD34"]],
  ["YT-AB12CD34\r\n", ["YT-AB12CD34"]],
  ["yt-ab12 cd34", ["YT-AB12CD34"]],
  ["036000291452", ["00036000291452"]],
  ["0036000291452", ["00036000291452"]],
  ["00036000291452", ["00036000291452"]],
  [" 036000291452\t", ["00036000291452"]],
  ["]E00036000291452", ["00036000291452"]],
  ["(01)00036000291452(17)271231", ["00036000291452"]],
  ["]C10100036000291452\u001d10LOTE7", ["00036000291452"]],
  ["0100036000291452", ["0100036000291452"]],
  ["04252614", ["00000004252614", "00042100005264"]],
  ["96385074", ["00000096385074"]],
  ["0123456789012345678", ["0123456789012345678"]],
  ["'; drop table skus; --", ["';DROPTABLESKUS;--"]],
  ["", []],
  [" \r\n\t", []],
];

function casesInSql(): Array<[string, string[]]> {
  const begin = sqlTest.indexOf("-- BEGIN scan_code_cases");
  const end = sqlTest.indexOf("-- END scan_code_cases");
  const block = sqlTest.slice(begin, end);
  const json = block.slice(block.indexOf("$json$") + 6, block.lastIndexOf("$json$"));
  return JSON.parse(json);
}

describe("scanned codes", () => {
  it("compare the usual spellings of one barcode", () => {
    for (const [raw, keys] of CASES) expect(codeKeys(raw), JSON.stringify(raw)).toEqual(keys);
  });

  it("are checked against the same table in the database's test", () => {
    expect(casesInSql()).toEqual(CASES);
  });

  it("match a line by its stock code or its barcode, never another product's", () => {
    const line = { sku_code: "YT-64D3BDF4", gtin: "036000291452" };
    expect(matchesTarget("yt-64d3bdf4", line)).toBe(true);
    expect(matchesTarget("0036000291452", line)).toBe(true);
    expect(matchesTarget("YT-DA4ED076", line)).toBe(false);
    expect(matchesTarget("", line)).toBe(false);
    expect(matchesTarget("", { sku_code: "", gtin: null })).toBe(false);
    expect(cleanScan("]C0YT-AB12CD34")).toBe("YT-AB12CD34");
  });
});

describe("the service area", () => {
  it("is the same box in the database's position check", () => {
    const body = /function private\.inside_service_area[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
      migration,
    )?.[1];
    expect(body).toContain(`p_lat between ${CR_BOUNDS.minLat.toFixed(1)} and ${CR_BOUNDS.maxLat}`);
    expect(body).toContain(
      `p_lng between ${CR_BOUNDS.minLng.toFixed(1)} and ${CR_BOUNDS.maxLng.toFixed(1)}`,
    );
  });
});
