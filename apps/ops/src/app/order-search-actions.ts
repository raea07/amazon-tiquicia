"use server";

/**
 * The console's order search (WEB-4). What staff type is often a shopper's
 * name, so it never goes into the address bar, the browser's history, the
 * request logs or a Referer header: the form is sent by POST, and the text is
 * kept in a short-lived, HttpOnly cookie that only /pedidos receives. The
 * status filter, which says nothing about anybody, stays in the address.
 */

import { ORDER_STATUSES } from "@yuntera/core";
import { type ActionState, redirectTo, signInPath } from "@yuntera/next-kit/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { ORDER_SEARCH_COOKIE, ORDER_SEARCH_MAX } from "@/lib/order-search";
import { currentStaff } from "@/lib/staff";

const searchSchema = z.object({
  q: z.string().trim().max(ORDER_SEARCH_MAX, "Escriba como máximo 80 caracteres."),
  estado: z.enum(ORDER_STATUSES).or(z.literal("")),
});

export async function searchOrders(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath("/pedidos"));
  const parsed = searchSchema.safeParse({
    q: String(formData.get("q") ?? ""),
    estado: String(formData.get("estado") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Revise la búsqueda.",
      values: { q: String(formData.get("q") ?? "").slice(0, ORDER_SEARCH_MAX) },
    };
  }
  const store = await cookies();
  if (parsed.data.q) {
    store.set(ORDER_SEARCH_COOKIE, parsed.data.q, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/pedidos",
      maxAge: 15 * 60,
    });
  } else {
    store.delete({ name: ORDER_SEARCH_COOKIE, path: "/pedidos" });
  }
  redirectTo(parsed.data.estado ? `/pedidos?estado=${parsed.data.estado}` : "/pedidos");
}

/** "Quitar la búsqueda": back to every order, keeping the status filter. */
export async function clearOrderSearch(formData: FormData): Promise<void> {
  if (!(await currentStaff())) redirectTo(signInPath("/pedidos"));
  (await cookies()).delete({ name: ORDER_SEARCH_COOKIE, path: "/pedidos" });
  const estado = z.enum(ORDER_STATUSES).safeParse(formData.get("estado"));
  redirectTo(estado.success ? `/pedidos?estado=${estado.data}` : "/pedidos");
}
