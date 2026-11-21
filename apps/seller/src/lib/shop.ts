import "server-only";
import type { Roles } from "@yuntera/db";
import { getRoles, redirectTo, requireRoles, sessionApi } from "@yuntera/next-kit/server";
import { cookies } from "next/headers";
import { cache } from "react";

const SHOP_COOKIE = "yt_shop";
const ONE_YEAR = 60 * 60 * 24 * 365;

export type Shop = Roles["sellers"][number];

function pick(roles: Roles, chosen: string | undefined): Shop | null {
  return roles.sellers.find((shop) => shop.id === chosen) ?? roles.sellers[0] ?? null;
}

/**
 * The shop the signed-in person is working in, or null. Someone can belong to
 * several shops; the choice is remembered in a cookie that holds only the
 * shop's id. The cookie is a preference, not a permission: the list of shops
 * comes from the database every time, and every call is checked there again.
 */
export async function currentShop(): Promise<{ roles: Roles; shop: Shop } | null> {
  const roles = await getRoles();
  if (!roles) return null;
  const shop = pick(roles, (await cookies()).get(SHOP_COOKIE)?.value);
  return shop ? { roles, shop } : null;
}

/** Like `currentShop`, but sends visitors to sign in and people without a shop to register one. */
export async function requireShop(returnTo: string): Promise<{ roles: Roles; shop: Shop }> {
  const roles = await requireRoles(returnTo);
  const shop = pick(roles, (await cookies()).get(SHOP_COOKIE)?.value);
  if (!shop) redirectTo("/registro");
  return { roles, shop };
}

export async function rememberShop(shopId: string): Promise<void> {
  (await cookies()).set(SHOP_COOKIE, shopId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

/** The shop's summary, read once per request however many components ask for it. */
export const getOverview = cache(async (shopId: string) =>
  (await sessionApi()).sellerOverview(shopId),
);
