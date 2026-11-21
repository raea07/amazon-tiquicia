/**
 * Order sourcing: decides which stock node ships each unit of an order.
 *
 * A node is a platform warehouse or a seller's own location. The goals, in
 * strict priority order:
 *   1. Fulfil as many units as possible.
 *   2. Use as few shipments as possible (each one costs a delivery stop and
 *      splits the customer's experience).
 *   3. Among equally compact plans, ship from the closest nodes.
 *
 * Minimum-shipment sourcing is a set-cover problem (NP-hard). Orders are small,
 * so the greedy cover used here — repeatedly take the node that covers the most
 * remaining units — is optimal or within one shipment in practice, and it is
 * deterministic, which matters more for debugging than the last 1%.
 *
 * This module is pure: it plans. Reserving the stock is done atomically in the
 * database (`reserve_inventory`), which re-checks availability under a lock and
 * fails the reservation if the plan went stale.
 */

import { haversineKm, type LatLng } from "./cr/geo";

export interface OrderLine {
  lineId: string;
  skuId: string;
  quantity: number;
  /** Lines are sold by a specific seller's offer, so only that seller's stock qualifies. */
  sellerId: string;
}

export interface StockNode {
  nodeId: string;
  kind: "platform_warehouse" | "seller_location";
  location: LatLng;
  /** For seller locations, the owning seller. Platform warehouses hold many sellers' stock. */
  sellerId?: string;
  /** Available-to-promise units, keyed by `${sellerId}:${skuId}`. */
  available: Readonly<Record<string, number>>;
  /** Nodes that cannot make the delivery promise are excluded by the caller, or flagged here. */
  enabled?: boolean;
}

export interface PlannedShipment {
  nodeId: string;
  kind: StockNode["kind"];
  distanceKm: number;
  items: Array<{ lineId: string; skuId: string; sellerId: string; quantity: number }>;
}

export interface SourcingPlan {
  shipments: PlannedShipment[];
  /** Units that no node could supply. Empty when the order is fully sourced. */
  unfulfilled: Array<{ lineId: string; skuId: string; quantity: number }>;
  fullySourced: boolean;
}

export const stockKey = (sellerId: string, skuId: string) => `${sellerId}:${skuId}`;

export function planSourcing(
  lines: readonly OrderLine[],
  nodes: readonly StockNode[],
  destination: LatLng,
): SourcingPlan {
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError(`Line ${line.lineId}: quantity must be a positive integer`);
    }
  }

  const remaining = new Map(lines.map((l) => [l.lineId, l.quantity]));
  // Mutable copy of availability so one node is not promised the same unit twice.
  const stock = new Map(
    nodes
      .filter((n) => n.enabled !== false)
      .map((n) => [n.nodeId, { node: n, available: new Map(Object.entries(n.available)) }]),
  );
  const distance = new Map(
    [...stock.values()].map(({ node }) => [node.nodeId, haversineKm(node.location, destination)]),
  );

  const shipments: PlannedShipment[] = [];

  while ([...remaining.values()].some((q) => q > 0)) {
    let best: { nodeId: string; covered: number; linesCompleted: number } | null = null;

    for (const { node, available } of stock.values()) {
      let covered = 0;
      let linesCompleted = 0;
      // Several lines can draw on the same stock key; track what this pass would consume.
      const used = new Map<string, number>();
      for (const line of lines) {
        const need = remaining.get(line.lineId) ?? 0;
        if (need <= 0) continue;
        if (node.kind === "seller_location" && node.sellerId !== line.sellerId) continue;
        const key = stockKey(line.sellerId, line.skuId);
        const free = (available.get(key) ?? 0) - (used.get(key) ?? 0);
        const take = Math.min(need, Math.max(0, free));
        if (take > 0) {
          covered += take;
          used.set(key, (used.get(key) ?? 0) + take);
          if (take === need) linesCompleted++;
        }
      }
      if (covered === 0) continue;

      const better =
        best === null ||
        covered > best.covered ||
        (covered === best.covered && linesCompleted > best.linesCompleted) ||
        (covered === best.covered &&
          linesCompleted === best.linesCompleted &&
          ((distance.get(node.nodeId) ?? 0) < (distance.get(best.nodeId) ?? 0) ||
            ((distance.get(node.nodeId) ?? 0) === (distance.get(best.nodeId) ?? 0) &&
              node.nodeId < best.nodeId)));
      if (better) best = { nodeId: node.nodeId, covered, linesCompleted };
    }

    if (!best) break; // nothing left that any node can supply

    const chosen = stock.get(best.nodeId);
    if (!chosen) break;
    const items: PlannedShipment["items"] = [];
    for (const line of lines) {
      const need = remaining.get(line.lineId) ?? 0;
      if (need <= 0) continue;
      if (chosen.node.kind === "seller_location" && chosen.node.sellerId !== line.sellerId)
        continue;
      const key = stockKey(line.sellerId, line.skuId);
      const take = Math.min(need, chosen.available.get(key) ?? 0);
      if (take <= 0) continue;
      chosen.available.set(key, (chosen.available.get(key) ?? 0) - take);
      remaining.set(line.lineId, need - take);
      items.push({
        lineId: line.lineId,
        skuId: line.skuId,
        sellerId: line.sellerId,
        quantity: take,
      });
    }
    shipments.push({
      nodeId: chosen.node.nodeId,
      kind: chosen.node.kind,
      distanceKm: distance.get(chosen.node.nodeId) ?? 0,
      items,
    });
  }

  const unfulfilled = lines
    .map((l) => ({ lineId: l.lineId, skuId: l.skuId, quantity: remaining.get(l.lineId) ?? 0 }))
    .filter((u) => u.quantity > 0);

  return { shipments, unfulfilled, fullySourced: unfulfilled.length === 0 };
}
