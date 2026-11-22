/** Serving web-standard `(Request) => Response` handlers from Node's http server. */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 5_000_000) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const method = req.method ?? "GET";
  return new Request(new URL(req.url ?? "/", origin), {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
  });
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** A loopback server for a handler. */
export function serve(
  port: number,
  host: string,
  origin: string,
  handler: (request: Request) => Promise<Response>,
) {
  const server = createServer((req, res) => {
    toRequest(req, origin)
      .then(handler)
      .then((response) => sendResponse(res, response))
      .catch((error: unknown) => {
        console.error(error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });
  server.listen(port, host);
  return server;
}
