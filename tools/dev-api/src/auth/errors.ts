/**
 * Auth errors in the shape the real server sends. A request carrying
 * `X-Supabase-Api-Version: 2024-01-01` (auth-js always sends it) gets
 * `{"code":"<error_code>","message":"…"}` plus the same header back, which is
 * what makes auth-js read `code`; anything else gets the legacy
 * `{"code":<status>,"error_code":"…","msg":"…"}`.
 */

import type { IncomingMessage } from "node:http";
import { HttpError } from "../context.ts";

export const API_VERSION = "2024-01-01";

export function authError(
  req: IncomingMessage,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): HttpError {
  const versioned = (req.headers["x-supabase-api-version"] ?? "") >= API_VERSION;
  return versioned
    ? new HttpError(
        status,
        { code, message, ...extra },
        { "x-supabase-api-version": API_VERSION, "x-sb-error-code": code },
      )
    : new HttpError(status, { code: status, error_code: code, msg: message, ...extra });
}

export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const isEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
