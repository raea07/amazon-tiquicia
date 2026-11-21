import "server-only";
import type { Roles } from "@yuntera/db";
import { getRoles, redirectTo, requireRoles } from "@yuntera/next-kit/server";

export type StaffRole = NonNullable<Roles["staff_role"]>;
export type Staff = Roles & { staff_role: StaffRole };

/**
 * The sections of the console and which roles work in each. This only decides
 * what is shown: every function behind a screen checks the caller's role in
 * the database, so hiding a link is never what keeps someone out.
 */
export const SECTIONS = [
  { href: "/", label: "Resumen", roles: ["ops", "support", "finance", "catalog"] },
  { href: "/pedidos", label: "Pedidos", roles: ["ops", "support", "finance"] },
  { href: "/despacho", label: "Despacho", roles: ["ops"] },
  { href: "/liquidaciones", label: "Liquidaciones", roles: ["ops", "finance"] },
  { href: "/atencion", label: "Atención", roles: ["support", "ops", "finance", "catalog"] },
  { href: "/mensajes", label: "Mensajes", roles: ["support"] },
  { href: "/catalogo", label: "Catálogo", roles: ["catalog"] },
  { href: "/vendedores", label: "Vendedores", roles: ["ops", "support", "finance"] },
  { href: "/repartidores", label: "Repartidores", roles: ["ops"] },
  { href: "/auditoria", label: "Auditoría", roles: [] },
] as const satisfies ReadonlyArray<{ href: string; label: string; roles: readonly StaffRole[] }>;

export const canSee = (role: StaffRole, allowed: readonly StaffRole[]) =>
  role === "admin" || allowed.includes(role);

/** The signed-in staff member, or null for anyone else. */
export async function currentStaff(): Promise<Staff | null> {
  const roles = await getRoles();
  return roles?.staff_role ? (roles as Staff) : null;
}

/**
 * Sends visitors to sign in and people who are not staff to an explanation.
 * With `allowed`, also turns away staff whose role does not work in that section.
 */
export async function requireStaff(
  returnTo: string,
  allowed?: readonly StaffRole[],
): Promise<Staff> {
  const roles = await requireRoles(returnTo);
  if (!roles.staff_role) redirectTo("/sin-acceso");
  if (allowed && !canSee(roles.staff_role, allowed)) redirectTo("/sin-acceso");
  return roles as Staff;
}
