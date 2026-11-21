/**
 * Every group of routes the stand-in serves, in the order they are tried.
 * To add an area (storage, a webhook, …): write src/routes/<area>.ts exporting
 * a `Routes` function, and add it to this list.
 */

import type { Routes } from "../context.ts";
import { authRoutes } from "./auth.ts";
import { devRoutes } from "./dev.ts";
import { restRoutes } from "./rest.ts";

export const routes: Routes[] = [restRoutes, authRoutes, devRoutes];
