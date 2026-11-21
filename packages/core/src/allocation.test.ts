import { describe, expect, it } from "vitest";
import { type OrderLine, planSourcing, type StockNode, stockKey } from "./allocation";

const SAN_JOSE = { lat: 9.9333, lng: -84.0833 };
const HEREDIA = { lat: 9.9981, lng: -84.1198 };
const CARTAGO = { lat: 9.8644, lng: -83.9194 };
const customer = { lat: 9.9281, lng: -84.0907 }; // near San José centre

const line = (lineId: string, skuId: string, quantity: number, sellerId = "s1"): OrderLine => ({
  lineId,
  skuId,
  quantity,
  sellerId,
});

const warehouse = (
  nodeId: string,
  location: typeof SAN_JOSE,
  stock: Record<string, number>,
): StockNode => ({
  nodeId,
  kind: "platform_warehouse",
  location,
  available: stock,
});

describe("order sourcing", () => {
  it("ships everything from one node when one node has it all", () => {
    const plan = planSourcing(
      [line("l1", "A", 2), line("l2", "B", 1)],
      [
        warehouse("far", CARTAGO, { [stockKey("s1", "A")]: 5, [stockKey("s1", "B")]: 5 }),
        warehouse("near-partial", SAN_JOSE, { [stockKey("s1", "A")]: 5 }),
      ],
      customer,
    );
    expect(plan.fullySourced).toBe(true);
    expect(plan.shipments).toHaveLength(1);
    expect(plan.shipments[0]?.nodeId).toBe("far");
  });

  it("prefers the closest node among equally complete options", () => {
    const stock = { [stockKey("s1", "A")]: 5 };
    const plan = planSourcing(
      [line("l1", "A", 1)],
      [
        warehouse("cartago", CARTAGO, stock),
        warehouse("san-jose", SAN_JOSE, stock),
        warehouse("heredia", HEREDIA, stock),
      ],
      customer,
    );
    expect(plan.shipments[0]?.nodeId).toBe("san-jose");
  });

  it("splits only when it has to, into as few shipments as possible", () => {
    const plan = planSourcing(
      [line("l1", "A", 1), line("l2", "B", 1), line("l3", "C", 1)],
      [
        warehouse("w1", SAN_JOSE, { [stockKey("s1", "A")]: 1, [stockKey("s1", "B")]: 1 }),
        warehouse("w2", HEREDIA, { [stockKey("s1", "C")]: 1 }),
        warehouse("w3", CARTAGO, { [stockKey("s1", "A")]: 1 }),
      ],
      customer,
    );
    expect(plan.fullySourced).toBe(true);
    expect(plan.shipments.map((s) => s.nodeId)).toEqual(["w1", "w2"]);
  });

  it("splits a single line across nodes when no node has enough", () => {
    const plan = planSourcing(
      [line("l1", "A", 5)],
      [
        warehouse("w1", SAN_JOSE, { [stockKey("s1", "A")]: 3 }),
        warehouse("w2", HEREDIA, { [stockKey("s1", "A")]: 4 }),
      ],
      customer,
    );
    expect(plan.fullySourced).toBe(true);
    const shipped = plan.shipments.flatMap((s) => s.items).reduce((t, i) => t + i.quantity, 0);
    expect(shipped).toBe(5);
    // The node covering more units goes first.
    expect(plan.shipments[0]?.nodeId).toBe("w2");
  });

  it("reports what cannot be sourced instead of failing", () => {
    const plan = planSourcing(
      [line("l1", "A", 4), line("l2", "Z", 1)],
      [warehouse("w1", SAN_JOSE, { [stockKey("s1", "A")]: 3 })],
      customer,
    );
    expect(plan.fullySourced).toBe(false);
    expect(plan.unfulfilled).toEqual([
      { lineId: "l1", skuId: "A", quantity: 1 },
      { lineId: "l2", skuId: "Z", quantity: 1 },
    ]);
  });

  it("only uses the stock of the seller whose offer was bought", () => {
    const plan = planSourcing(
      [line("l1", "A", 1, "s1")],
      [warehouse("w1", SAN_JOSE, { [stockKey("s2", "A")]: 10 })],
      customer,
    );
    expect(plan.fullySourced).toBe(false);
  });

  it("never ships one seller's order from another seller's location", () => {
    const nodes: StockNode[] = [
      {
        nodeId: "other-sellers-shop",
        kind: "seller_location",
        sellerId: "s2",
        location: SAN_JOSE,
        // Mis-keyed stock must still not leak across sellers.
        available: { [stockKey("s1", "A")]: 10 },
      },
      {
        nodeId: "own-shop",
        kind: "seller_location",
        sellerId: "s1",
        location: CARTAGO,
        available: { [stockKey("s1", "A")]: 10 },
      },
    ];
    const plan = planSourcing([line("l1", "A", 1, "s1")], nodes, customer);
    expect(plan.shipments.map((s) => s.nodeId)).toEqual(["own-shop"]);
  });

  it("does not promise the same unit to two lines", () => {
    const plan = planSourcing(
      [line("l1", "A", 2), line("l2", "A", 2)],
      [warehouse("w1", SAN_JOSE, { [stockKey("s1", "A")]: 3 })],
      customer,
    );
    const shipped = plan.shipments.flatMap((s) => s.items).reduce((t, i) => t + i.quantity, 0);
    expect(shipped).toBe(3);
    expect(plan.unfulfilled.reduce((t, u) => t + u.quantity, 0)).toBe(1);
  });

  it("skips disabled nodes", () => {
    const plan = planSourcing(
      [line("l1", "A", 1)],
      [{ ...warehouse("w1", SAN_JOSE, { [stockKey("s1", "A")]: 5 }), enabled: false }],
      customer,
    );
    expect(plan.fullySourced).toBe(false);
  });

  it("conserves units for arbitrary orders", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const skus = ["A", "B", "C", "D"];
    for (let run = 0; run < 200; run++) {
      const lines = skus
        .filter(() => rand() > 0.3)
        .map((sku, i) => line(`l${i}`, sku, 1 + Math.floor(rand() * 4)));
      if (lines.length === 0) continue;
      const nodes = [SAN_JOSE, HEREDIA, CARTAGO].map((loc, i) =>
        warehouse(
          `w${i}`,
          loc,
          Object.fromEntries(skus.map((sku) => [stockKey("s1", sku), Math.floor(rand() * 4)])),
        ),
      );
      const plan = planSourcing(lines, nodes, customer);

      for (const l of lines) {
        const shipped = plan.shipments
          .flatMap((s) => s.items)
          .filter((i) => i.lineId === l.lineId)
          .reduce((t, i) => t + i.quantity, 0);
        const missing = plan.unfulfilled.find((u) => u.lineId === l.lineId)?.quantity ?? 0;
        expect(shipped + missing).toBe(l.quantity);
      }
      for (const node of nodes) {
        for (const sku of skus) {
          const taken = plan.shipments
            .filter((s) => s.nodeId === node.nodeId)
            .flatMap((s) => s.items)
            .filter((i) => i.skuId === sku)
            .reduce((t, i) => t + i.quantity, 0);
          expect(taken).toBeLessThanOrEqual(node.available[stockKey("s1", sku)] ?? 0);
        }
      }
    }
  });

  it("rejects invalid quantities", () => {
    expect(() => planSourcing([line("l1", "A", 0)], [], customer)).toThrow(RangeError);
  });
});
