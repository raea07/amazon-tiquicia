// Run with `pnpm --filter @yuntera/seller-native test` (Node's test runner through tsx).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePlusCode, encodePlusCode } from "@yuntera/core";
import { readPlusCode } from "./plus-code";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("readPlusCode", () => {
  it("reads a full code as core's decodePlusCode does", () => {
    const read = readPlusCode("66XRQ4XR+RH");
    assert.ok(read.ok);
    const expected = decodePlusCode("66XRQ4XR+RH");
    assert.ok(expected);
    assert.ok(near(read.point.lat, expected.lat) && near(read.point.lng, expected.lng));
    assert.equal(read.plusCode, "66XRQ4XR+RH");
    assert.equal(read.recovered, false);
  });

  it("recovers the short code Google Maps shows, ignoring the place name", () => {
    // Orosi, Cartago: the cell east of San José's (84° W), so the prefix has to be corrected.
    for (const input of ["Q4XR+RH Orosi, Cartago", "q4xr+rh", "  Q4XR+RH  "]) {
      const read = readPlusCode(input);
      assert.ok(read.ok, input);
      assert.equal(read.plusCode, "66XRQ4XR+RH", input);
      assert.equal(read.recovered, true);
    }
  });

  it("recovers short codes across the whole area we collect from", () => {
    // The corners and edges of the active delivery zones, a little beyond them.
    const points = [
      { lat: 9.93, lng: -84.08 }, // San José
      { lat: 9.98, lng: -84.4 }, // Atenas, west
      { lat: 10.25, lng: -84.25 }, // above Poás and Varablanca, north
      { lat: 9.55, lng: -83.95 }, // El Guarco, south
      { lat: 9.75, lng: -83.7 }, // Paraíso, east
      { lat: 10.25, lng: -83.7 },
      { lat: 9.55, lng: -84.4 },
    ];
    for (const p of points) {
      const full = encodePlusCode(p);
      const read = readPlusCode(`${full.slice(4)} Costa Rica`);
      assert.ok(read.ok, full);
      assert.equal(read.plusCode, full, `${p.lat}, ${p.lng}`);
    }
  });

  it("refuses what is not a Plus Code, or a point outside Costa Rica", () => {
    assert.deepEqual(readPlusCode(""), { ok: false, reason: "invalid" });
    assert.deepEqual(readPlusCode("Orosi"), { ok: false, reason: "invalid" });
    assert.deepEqual(readPlusCode("Q4X+RH"), { ok: false, reason: "invalid" });
    assert.deepEqual(readPlusCode("66XRQ4XR+R"), { ok: false, reason: "invalid" });
    // Madrid's full code.
    assert.deepEqual(readPlusCode("8CGRC78X+3C"), { ok: false, reason: "outside" });
  });
});
