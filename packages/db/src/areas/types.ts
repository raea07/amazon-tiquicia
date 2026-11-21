import type { z } from "zod";

/** A message for every error code, in both languages. */
export type Messages = Record<string, { "es-CR": string; en: string }>;

/**
 * How an area calls the database. `call` validates the answer against a schema
 * and returns it typed; `run` is for functions whose answer is not used.
 * Failures arrive as `ApiError`, already translated from the database's codes.
 */
export interface Caller {
  call<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T>;
  run(fn: string, args?: Record<string, unknown>): Promise<void>;
}
