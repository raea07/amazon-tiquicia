import "server-only";
import { publicApi } from "@yuntera/next-kit/server";
import { cacheLife, cacheTag } from "next/cache";

/** Reference data that is the same for everyone, so it is cached and shared. */

export async function getCategories() {
  "use cache";
  cacheLife("hours");
  cacheTag("categories");
  return publicApi().listCategories();
}

export async function getDistricts() {
  "use cache";
  cacheLife("days");
  cacheTag("districts");
  return publicApi().listDistricts();
}
