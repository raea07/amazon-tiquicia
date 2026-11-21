import "server-only";
import type { Roles } from "@yuntera/db";
import { redirectTo, requireRoles, secondStepPath } from "@yuntera/next-kit/server";

export type Warehouse = Roles["warehouses"][number];

/**
 * Who may use each half of this app. These checks choose what to show; the
 * database checks again on every call (a driver can only touch their own
 * route, a warehouse worker only their own warehouse).
 */

/** The second step first, for anyone whose account has an authenticator. */
async function passedSecondStep(returnTo: string) {
  const step = await secondStepPath(returnTo);
  if (step) redirectTo(step);
}

export async function requireDriver(returnTo: string) {
  const roles = await requireRoles(returnTo);
  await passedSecondStep(returnTo);
  if (roles.driver?.status !== "active") redirectTo("/sin-acceso");
  return roles.driver;
}

export async function requireWarehouse(returnTo: string, chosen?: string): Promise<Warehouse> {
  const roles = await requireRoles(returnTo);
  await passedSecondStep(returnTo);
  const warehouse = roles.warehouses.find((w) => w.id === chosen) ?? roles.warehouses[0];
  if (!warehouse) redirectTo("/sin-acceso");
  return warehouse;
}
