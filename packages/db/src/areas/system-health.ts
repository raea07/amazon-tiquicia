/**
 * The console's system health page (Salud del sistema), the versions panel
 * and the uptime robot's ping.
 *
 * SQL: supabase/migrations/20261121084800_system_health.sql (its header says
 * which role reads which line, what each line watches and why the jobs'
 * history may be unavailable).
 */

import { z } from "zod";
import type { Caller, Messages } from "./types";

const count = z.number().int().min(0);
const instant = z.string().nullable();

export const HEALTH_LINE_KEYS = [
  "messages_stopped",
  "messages_late",
  "events_failed",
  "invoices",
  "invoice_certificate",
  "refunds_failed",
  "payments_failed",
  "payments_worker",
  "jobs",
  "orders_unpaid_overdue",
  "orders_not_released",
  "routes_open",
  "sign_ins_failed",
] as const;
export type HealthLineKey = (typeof HEALTH_LINE_KEYS)[number];

export const HEALTH_STATES = ["ok", "attention", "problem", "unknown"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** One check. Counts and order numbers or route codes only: never a person. */
export const healthLine = z.object({
  key: z.enum(HEALTH_LINE_KEYS),
  state: z.enum(HEALTH_STATES),
  count,
  /** The oldest thing the line counts, when it has a time. */
  since: instant,
  /** Until when a pause runs, or when the certificate expires. */
  until: instant,
  /** Order numbers, route codes, channel or job names. */
  refs: z.array(z.string()),
  /** The parts of the count, and thresholds such as `attention_from`. */
  parts: z.record(z.string(), count),
  /** The time limit the line applies, in minutes. */
  minutes: z.number().int().min(0).nullable(),
});
export type HealthLine = z.infer<typeof healthLine>;

export const healthJob = z.object({
  name: z.string(),
  every_seconds: z.number().int().positive(),
  late_after_seconds: z.number().int().positive(),
  last_run_at: instant,
  last_status: z.enum(["succeeded", "failed", "running"]).nullable(),
  state: z.enum(HEALTH_STATES),
  reason: z.enum([
    "no_history",
    "not_scheduled",
    "inactive",
    "failed",
    "never_ran",
    "late",
    "on_time",
  ]),
});
export type HealthJob = z.infer<typeof healthJob>;

export const systemHealth = z.object({
  checked_at: z.string(),
  lines: z.array(healthLine),
  /** Operations staff and administrators only. */
  jobs: z
    .object({
      history: z.enum(["available", "unavailable"]),
      reason: z.enum(["not_installed", "not_logged", "no_access"]).nullable(),
      items: z.array(healthJob),
    })
    .nullable(),
});
export type SystemHealth = z.infer<typeof systemHealth>;

export const STORE_APPS = ["shop", "seller", "driver", "warehouse"] as const;
export type StoreApp = (typeof STORE_APPS)[number];
export const STORE_PLATFORMS = ["ios", "android"] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];
export const STORE_TRACKS = ["internal", "public"] as const;
export type StoreTrack = (typeof STORE_TRACKS)[number];

/** What the database accepts (ops_set_store_build). */
export const STORE_BUILD = {
  version: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/,
  buildNumber: [1, 999_999_999],
  /** The first day a build may be dated. The last is today in Costa Rica. */
  firstDay: "2026-01-01",
} as const;

export const storeBuild = z.object({
  id: z.uuid(),
  app: z.enum(STORE_APPS),
  platform: z.enum(STORE_PLATFORMS),
  version: z.string(),
  build_number: z.number().int().positive(),
  released_on: z.string(),
  track: z.enum(STORE_TRACKS),
  recorded_at: z.string(),
});
export type StoreBuild = z.infer<typeof storeBuild>;

export const versions = z.object({
  migration_history: z.enum(["available", "unavailable"]),
  /** The newest migration the database recorded, and how many it recorded. */
  migration: z.object({ version: z.string(), name: z.string().nullable(), count }).nullable(),
  store_builds: z.array(storeBuild),
});
export type Versions = z.infer<typeof versions>;

export const healthPing = z.object({ ok: z.literal(true) }).strict();

export interface StoreBuildInput {
  app: StoreApp;
  platform: StorePlatform;
  version: string;
  buildNumber: number;
  /** YYYY-MM-DD, Costa Rica. */
  releasedOn: string;
  track: StoreTrack;
}

export const systemHealthErrors = {
  store_build_invalid: {
    "es-CR":
      "No se guardó la versión: revise la aplicación, la plataforma, la versión (como 1.2.0), el número de compilación (un número entero desde 1), la fecha (desde 2026 y no después de hoy) y dónde está.",
    en: "The build was not saved: check the app, the platform, the version (such as 1.2.0), the build number (a whole number from 1), the date (from 2026 and not after today) and where it is.",
  },
} as const satisfies Messages;

export const systemHealthApi = ({ call }: Caller) => ({
  /** The health page: the lines the caller's role reads, and the jobs for operations. */
  opsSystemHealth: () => call("ops_system_health", {}, systemHealth),
  /** Whether the database answers; for an outside uptime robot. Visitors may call it. */
  healthPing: () => call("health_ping", {}, healthPing),
  /** Administrators: the newest migration and the phone builds. */
  opsVersions: () => call("ops_versions", {}, versions),
  /** Administrators: records a phone build, or updates its day and where it is. */
  opsSetStoreBuild: (input: StoreBuildInput) =>
    call(
      "ops_set_store_build",
      {
        p_app: input.app,
        p_platform: input.platform,
        p_version: input.version,
        p_build_number: input.buildNumber,
        p_released_on: input.releasedOn,
        p_track: input.track,
      },
      storeBuild,
    ),
});
