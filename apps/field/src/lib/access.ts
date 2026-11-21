import "server-only";
import type { Roles } from "@yuntera/db";
import { redirectTo, requireRoles } from "@yuntera/next-kit/server";

export type Warehouse = Roles["warehouses"][number];

/**
 * Who may use each half of this app. These checks choose what to show; the
 * database checks again on every call (a driver can only touch their own
 * route, a warehouse worker only their own warehouse).
 */

export async function requireDriver(returnTo: string) {
  const roles = await requireRoles(returnTo);
  if (roles.driver?.status !== "active") redirectTo("/sin-acceso");
  return roles.driver;
}

export async function requireWarehouse(returnTo: string, chosen?: string): Promise<Warehouse> {
  const roles = await requireRoles(returnTo);
  const warehouse = roles.warehouses.find((w) => w.id === chosen) ?? roles.warehouses[0];
  if (!warehouse) redirectTo("/sin-acceso");
  return warehouse;
}
