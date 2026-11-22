import type { FiscalDocument } from "./document.ts";
import type { HaciendaState } from "./hacienda.ts";

/** A document handed to the worker by the database (public.worker_invoice_claim). */
export interface ClaimedInvoice {
  id: string;
  /** "submit": sign if not yet signed, then send. "poll": ask Hacienda for its answer. */
  phase: "submit" | "poll";
  document: FiscalDocument;
  /** The signed XML once stored: every later attempt sends exactly these bytes. */
  signed_xml: string | null;
  /** A submission was attempted before without a known outcome: ask before sending again. */
  submitted_before: boolean;
  attempts: number;
}

/** What happened to a document, reported back with public.worker_invoice_record. */
export type Outcome =
  | { event: "received"; http_status: number; location: string | null }
  | { event: "duplicate"; http_status: number; cause: string }
  | { event: "refused"; http_status: number; cause: string }
  | {
      event: "answer";
      state: HaciendaState;
      response_xml: string | null;
      response_sha256: string | null;
      message: string | null;
      detail: string | null;
    }
  | { event: "unknown_clave"; http_status: number; cause: string }
  | {
      event: "retry";
      http_status: number | null;
      code: string;
      message: string;
      retry_after: number | null;
    }
  | { event: "config"; http_status: number | null; code: string; message: string }
  | { event: "invalid"; code: string };

export interface HealthReport {
  certificate_subject: string | null;
  certificate_issuer: string | null;
  certificate_not_after: string | null;
  environment: string;
  error: string | null;
}

export interface InvoiceQueue {
  plan(limit: number): Promise<number>;
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedInvoice[]>;
  /** Stores the signed XML once; returns what is stored (the earlier copy if one exists), or null if the lease was lost. */
  signed(id: string, workerId: string, xml: string, sha256: string): Promise<string | null>;
  record(id: string, workerId: string, outcome: Outcome): Promise<string | null>;
  /** Hacienda's callback named this clave: poll it now. */
  hint(clave: string): Promise<boolean>;
  health(report: HealthReport): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Logs carry ids, codes and counts only: never a name, an identification number or XML. */
export const consoleLogger: Logger = {
  info: (message, fields) => console.info(`[invoice] ${message}`, fields ?? ""),
  warn: (message, fields) => console.warn(`[invoice] ${message}`, fields ?? ""),
  error: (message, fields) => console.error(`[invoice] ${message}`, fields ?? ""),
};
