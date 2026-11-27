/**
 * A stand-in for the error tracker, for the tests: a small HTTP server on
 * this machine that accepts what the SDK sends and keeps it, so a test can
 * read exactly what would have reached the tracker. It never forwards
 * anything. The error-reports journey (tools/e2e) has its own copy in plain
 * JavaScript.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";

export interface Arrival {
  path: string;
  query: string;
  headers: IncomingMessage["headers"];
  /** The raw body as text (envelopes are newline-separated JSON). */
  body: string;
  /** The items of the envelope: [header, payload] pairs. */
  items: Array<{ header: Record<string, unknown>; payload: unknown }>;
}

export interface StandIn {
  url: string;
  port: number;
  arrivals: Arrival[];
  /** The error events received, in order. */
  events(): Array<Record<string, unknown>>;
  close(): Promise<void>;
}

/** Parses a Sentry envelope: a header line, then pairs of item header and payload lines. */
export function parseEnvelope(body: string): Arrival["items"] {
  const lines = body.split("\n").filter((line) => line.length > 0);
  const items: Arrival["items"] = [];
  for (let i = 1; i < lines.length; i += 2) {
    const header = JSON.parse(lines[i] ?? "{}") as Record<string, unknown>;
    let payload: unknown = lines[i + 1] ?? null;
    try {
      payload = JSON.parse(String(payload));
    } catch {
      // Leave a non-JSON payload as text.
    }
    items.push({ header, payload });
  }
  return items;
}

export async function startStandIn(port = 0): Promise<StandIn> {
  const arrivals: Arrival[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      let raw = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
      const body = raw.toString("utf8");
      const [path = "", query = ""] = (request.url ?? "").split("?");
      arrivals.push({ path, query, headers: request.headers, body, items: parseEnvelope(body) });
      response.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    arrivals,
    events: () =>
      arrivals.flatMap((arrival) =>
        arrival.items
          .filter((item) => item.header.type === "event")
          .map((item) => item.payload as Record<string, unknown>),
      ),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
