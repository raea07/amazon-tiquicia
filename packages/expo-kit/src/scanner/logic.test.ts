import { describe, expect, it } from "vitest";
import {
  cleanScan,
  codeKeys,
  createNumberFieldGuard,
  createScanGate,
  createScanQueue,
  expandUpcE,
  findByForms,
  gtinCheckDigit,
  isValidGtin,
  lookupForms,
  MAX_CODE_LENGTH,
  matchesTarget,
  matchScan,
  readCaption,
  readScan,
  SYMBOLOGIES,
  shortCode,
  validateScan,
} from "./logic";

describe("symbologies", () => {
  it("reads the retail and logistics codes of the research note, and nothing for video or photos", () => {
    expect([...SYMBOLOGIES].sort()).toEqual(
      ["code128", "code39", "ean13", "ean8", "itf14", "qr", "upc_a", "upc_e"].sort(),
    );
  });
});

describe("cleanScan", () => {
  it("drops what a hand scanner adds around the code", () => {
    expect(cleanScan("YT-AB12CD34\r\n")).toBe("YT-AB12CD34");
    expect(cleanScan("\tYT-AB12CD34\n")).toBe("YT-AB12CD34");
    expect(cleanScan("]C0YT-AB12CD34")).toBe("YT-AB12CD34");
    expect(cleanScan("]E07441234567896")).toBe("7441234567896");
  });

  it("writes stock codes in capitals and removes spaces typed by hand", () => {
    expect(cleanScan("  yt-ab12 cd34 ")).toBe("YT-AB12CD34");
  });

  it("reduces a GS1 element string to its GTIN", () => {
    expect(cleanScan("]C10107441234567893\u001d17271231")).toBe("07441234567893");
    expect(cleanScan("(01)07441234567893(17)271231")).toBe("07441234567893");
  });

  it("reduces a bare element string a scanner sends with its GS separator", () => {
    expect(cleanScan("\u001d0107441234567892\u001d17271231")).toBe("07441234567892");
    expect(cleanScan("0107441234567892\u001d10LOTE7")).toBe("07441234567892");
    expect(readScan("\u001d0107441234567892\u001d17271231")).toEqual({
      ok: true,
      code: "07441234567892",
    });
    // A misread check digit is then refused, rather than looked up as a long number.
    expect(readScan("\u001d0107441234567890\u001d17271231").ok).toBe(false);
    // Without the separator, a long number is left as it is (it may be a Code 128).
    expect(cleanScan("0107441234567892")).toBe("0107441234567892");
  });

  it("leaves a plain Code 128 that starts with 01 alone", () => {
    expect(cleanScan("0123456789012345678")).toBe("0123456789012345678");
  });

  it("returns an empty string for nothing but noise", () => {
    expect(cleanScan(" \r\n\t")).toBe("");
  });
});

describe("GTIN check digits", () => {
  it("computes the GS1 check digit", () => {
    expect(gtinCheckDigit("03600029145")).toBe(2); // UPC-A 036000291452
    expect(gtinCheckDigit("400638133393")).toBe(1); // EAN-13 4006381333931
    expect(gtinCheckDigit("9638507")).toBe(4); // EAN-8 96385074
  });

  it("accepts valid GTIN-8, 12, 13 and 14 and refuses a wrong last digit", () => {
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("036000291452")).toBe(true);
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("14006381333938")).toBe(true);
    expect(isValidGtin("YT-1234")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
  });
});

describe("expandUpcE", () => {
  it("writes UPC-E out as its UPC-A, for each rule of the last data digit", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
    expect(expandUpcE("01234505")).toBe("012000003455");
  });

  it("refuses what cannot be a UPC-E", () => {
    expect(expandUpcE("24252614")).toBeNull(); // number system 2
    expect(expandUpcE("04252615")).toBeNull(); // wrong check digit
    expect(expandUpcE("0425261")).toBeNull();
  });
});

describe("validateScan", () => {
  it("asks for a code when there is none", () => {
    expect(validateScan("")).toEqual({ ok: false, error: "Escanee o escriba el código." });
  });

  it("refuses a code that is too long or has characters no label carries", () => {
    const long = validateScan("A".repeat(MAX_CODE_LENGTH + 1));
    expect(long.ok).toBe(false);
    expect(validateScan("YT-<script>").ok).toBe(false);
    expect(validateScan("-YT").ok).toBe(false);
  });

  it("refuses a long barcode number whose check digit is wrong, in Spanish, without a code", () => {
    const result = validateScan("4006381333932");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/leído o escrito mal/);
  });

  it("accepts stock codes, valid barcodes and 8-digit numbers", () => {
    expect(validateScan("YT-AB12CD34")).toEqual({ ok: true, code: "YT-AB12CD34" });
    expect(validateScan("4006381333931").ok).toBe(true);
    expect(validateScan("12345670").ok).toBe(true);
    expect(validateScan("12345678").ok).toBe(true);
  });

  it("readScan cleans first", () => {
    expect(readScan(" yt-ab12cd34\r")).toEqual({ ok: true, code: "YT-AB12CD34" });
  });
});

describe("matching a scan to the expected line", () => {
  const nimbo = { id: "a", sku_code: "YT-AB12CD34", gtin: "036000291452" };
  const cafe = { id: "b", sku_code: "YT-CAFE0001", gtin: null };
  const upc = { id: "c", sku_code: "YT-UPCE0001", gtin: "042100005264" };

  it("matches the stock code in any case and the barcode in its other forms", () => {
    expect(matchesTarget("yt-ab12cd34", nimbo)).toBe(true);
    expect(matchesTarget("036000291452", nimbo)).toBe(true);
    // iOS reads a UPC-A as an EAN-13 with a leading zero.
    expect(matchesTarget("0036000291452", nimbo)).toBe(true);
    expect(matchesTarget("00036000291452", nimbo)).toBe(true);
    // A UPC-E on the box, a UPC-A in the catalogue.
    expect(matchesTarget("04252614", upc)).toBe(true);
  });

  it("does not match another product, nor a product with no barcode by a number", () => {
    expect(matchesTarget("YT-CAFE0001", nimbo)).toBe(false);
    expect(matchesTarget("4006381333931", nimbo)).toBe(false);
    expect(matchesTarget("036000291452", cafe)).toBe(false);
  });

  it("tells the expected line, another waiting line and no line apart", () => {
    expect(matchScan("YT-AB12CD34", nimbo, [nimbo, cafe])).toEqual({
      kind: "expected",
      line: nimbo,
    });
    expect(matchScan("YT-CAFE0001", nimbo, [nimbo, cafe])).toEqual({ kind: "other", line: cafe });
    expect(matchScan("YT-NOPE0000", nimbo, [nimbo, cafe])).toEqual({ kind: "none" });
    expect(matchScan("YT-CAFE0001", null, [nimbo, cafe])).toEqual({ kind: "other", line: cafe });
  });
});

describe("createScanGate", () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("turns many sightings of one code into one read", () => {
    const time = clock();
    const gate = createScanGate({ repeatMs: 1500, now: time.now });
    expect(gate.offer("YT-AB12CD34")).toBe("YT-AB12CD34");
    gate.release();
    for (let i = 0; i < 30; i++) {
      time.advance(100);
      expect(gate.offer("YT-AB12CD34")).toBeNull();
    }
  });

  it("reads the same code again once it has been out of view for the wait", () => {
    const time = clock();
    const gate = createScanGate({ repeatMs: 1500, now: time.now });
    gate.offer("YT-AB12CD34");
    gate.release();
    time.advance(1000);
    expect(gate.offer("YT-AB12CD34")).toBeNull(); // still in view: restarts the wait
    time.advance(1499);
    expect(gate.offer("YT-AB12CD34")).toBeNull();
    time.advance(1500);
    expect(gate.offer("YT-AB12CD34")).toBe("YT-AB12CD34");
  });

  it("takes no read at all while the last one is being handled", () => {
    const time = clock();
    const gate = createScanGate({ now: time.now });
    expect(gate.offer("YT-AAAA0001")).toBe("YT-AAAA0001");
    expect(gate.busy).toBe(true);
    time.advance(50);
    expect(gate.offer("YT-BBBB0002")).toBeNull();
    gate.release();
    // Seen while busy counts as seen: it must leave the frame before it fires.
    time.advance(50);
    expect(gate.offer("YT-BBBB0002")).toBeNull();
    time.advance(2000);
    expect(gate.offer("YT-BBBB0002")).toBe("YT-BBBB0002");
  });

  it("reads a different code at once when idle, and cleans what it reads", () => {
    const time = clock();
    const gate = createScanGate({ now: time.now });
    expect(gate.offer("yt-aaaa0001\n")).toBe("YT-AAAA0001");
    gate.release();
    time.advance(10);
    expect(gate.offer("YT-BBBB0002")).toBe("YT-BBBB0002");
    gate.release();
    expect(gate.offer("  ")).toBeNull();
  });

  it("forgets every code on reset", () => {
    const time = clock();
    const gate = createScanGate({ now: time.now });
    gate.offer("YT-AAAA0001");
    gate.reset();
    expect(gate.busy).toBe(false);
    expect(gate.offer("YT-AAAA0001")).toBe("YT-AAAA0001");
  });
});

describe("codeKeys", () => {
  it("pads numbers to 14 digits and leaves stock codes as they are", () => {
    expect(codeKeys("036000291452")).toEqual(["00036000291452"]);
    expect(codeKeys("YT-AB12CD34")).toEqual(["YT-AB12CD34"]);
    expect(codeKeys("04252614")).toEqual(["00000004252614", "00042100005264"]);
  });
});

describe("lookupForms", () => {
  it("tries the code as read first, then the same GTIN at its other lengths", () => {
    expect(lookupForms("0036000291452")).toEqual([
      "0036000291452",
      "036000291452",
      "00036000291452",
    ]);
    expect(lookupForms("036000291452")).toEqual([
      "036000291452",
      "0036000291452",
      "00036000291452",
    ]);
  });

  it("adds the UPC-A behind a UPC-E", () => {
    expect(lookupForms("04252614")).toContain("042100005264");
  });

  it("leaves stock codes and other text as one form", () => {
    expect(lookupForms("yt-ab12cd34")).toEqual(["YT-AB12CD34"]);
    expect(lookupForms("123456789012345678")).toEqual(["123456789012345678"]);
  });
});

describe("shortCode", () => {
  it("leaves a normal code alone and cuts a long one", () => {
    expect(shortCode("YT-AB12CD34")).toBe("YT-AB12CD34");
    const long = shortCode("A".repeat(100_000));
    expect([...long]).toHaveLength(MAX_CODE_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("findByForms", () => {
  // The database compares barcodes as stored: only the exact spelling answers.
  const stored = new Map([["012345678905", { sku_code: "YT-4C4384BC" }]]);
  const lookup = async (form: string) => stored.get(form) ?? null;

  it("finds a UPC-A product scanned in its iOS EAN-13 or GTIN-14 form", async () => {
    expect(await findByForms("0012345678905", lookup)).toEqual({ sku_code: "YT-4C4384BC" });
    expect(await findByForms("00012345678905", lookup)).toEqual({ sku_code: "YT-4C4384BC" });
    expect(await findByForms("012345678905", lookup)).toEqual({ sku_code: "YT-4C4384BC" });
  });

  it("stops at the first answer and says null when no spelling is known", async () => {
    const asked: string[] = [];
    const counting = async (form: string) => {
      asked.push(form);
      return stored.get(form) ?? null;
    };
    await findByForms("012345678905", counting);
    expect(asked).toEqual(["012345678905"]);
    expect(await findByForms("4006381333931", lookup)).toBeNull();
  });
});

describe("createScanQueue", () => {
  it("keeps a read that comes in while the last is being checked, and runs it next", async () => {
    const handled: string[] = [];
    let finish: () => void = () => {};
    const queue = createScanQueue(async (code: string) => {
      handled.push(`start ${code}`);
      if (code === "A") await new Promise<void>((resolve) => (finish = resolve));
      handled.push(`end ${code}`);
    });
    const first = queue.push("A");
    expect(await queue.push("B")).toBe("queued");
    expect(queue.waiting).toBe(1);
    expect(handled).toEqual(["start A"]);
    finish();
    expect(await first).toBe("ran");
    expect(handled).toEqual(["start A", "end A", "start B", "end B"]);
    expect(queue.busy).toBe(false);
  });

  it("bounds the wait and goes on after a failed read", async () => {
    let finish: () => void = () => {};
    const handled: string[] = [];
    const queue = createScanQueue(
      async (code: string) => {
        if (code === "A") await new Promise<void>((resolve) => (finish = resolve));
        if (code === "B") throw new Error("boom");
        handled.push(code);
      },
      { limit: 2 },
    );
    const first = queue.push("A");
    await queue.push("B");
    await queue.push("C");
    expect(await queue.push("D")).toBe("dropped");
    finish();
    await first;
    expect(handled).toEqual(["A", "C"]);
  });
});

describe("readCaption", () => {
  it("shows no tick while the code is being checked", () => {
    expect(readCaption({ phase: "checking", code: "YT-NOPE0000" })).toEqual({
      icon: null,
      text: "Revisando YT-NOPE0000…",
    });
  });

  it("tells an accepted read from a refused one in words and icon", () => {
    expect(readCaption({ phase: "done", tone: "success", code: "YT-AB12CD34" })).toEqual({
      icon: "check",
      text: "Correcto · YT-AB12CD34",
    });
    expect(readCaption({ phase: "done", tone: "danger", code: "YT-NOPE0000" })).toEqual({
      icon: "cross",
      text: "No se aceptó · YT-NOPE0000",
    });
    expect(
      readCaption({ phase: "done", tone: "danger", title: "Es de otra línea", code: "X" }).text,
    ).toBe("Es de otra línea · X");
    expect(readCaption({ phase: "done", tone: "warning" }).icon).toBe("attention");
    expect(readCaption(null)).toEqual({ icon: null, text: "Ponga el código dentro del marco" });
  });
});

describe("createNumberFieldGuard", () => {
  const clock = () => {
    let t = 1000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };
  const typeInto = (
    guard: ReturnType<typeof createNumberFieldGuard>,
    time: ReturnType<typeof clock>,
    start: string,
    chars: string,
    gap: number,
  ) => {
    let value = start;
    let scan: string | undefined;
    for (const char of chars) {
      time.advance(gap);
      const result = guard.change(value + char);
      value = result.value;
      if (result.scan !== undefined) return { value, scan, rest: result.scan };
    }
    return { value, scan, rest: undefined };
  };

  it("hands a stock code typed into the number back to the scan field", () => {
    const time = clock();
    const guard = createNumberFieldGuard({ now: time.now });
    guard.reset("4");
    // The worker clears the field and types 1, then the scanner starts.
    time.advance(500);
    expect(guard.change("")).toEqual({ value: "" });
    time.advance(500);
    expect(guard.change("1")).toEqual({ value: "1" });
    time.advance(800);
    expect(guard.change("1Y")).toEqual({ value: "1", scan: "Y" });
  });

  it("hands back a barcode of digits sent as a fast burst and Enter", () => {
    const time = clock();
    const guard = createNumberFieldGuard({ now: time.now });
    guard.reset("");
    time.advance(500);
    guard.change("2");
    time.advance(600);
    const typed = typeInto(guard, time, "2", "0036000291452", 5);
    expect(typed.rest).toBeUndefined();
    time.advance(5);
    expect(guard.enter()).toEqual({ value: "2", scan: "0036000291452" });
  });

  it("leaves a number typed by hand alone, Enter included", () => {
    const time = clock();
    const guard = createNumberFieldGuard({ now: time.now });
    guard.reset("");
    typeInto(guard, time, "", "12", 300);
    time.advance(400);
    expect(guard.enter()).toEqual({ value: "12" });
  });
});
