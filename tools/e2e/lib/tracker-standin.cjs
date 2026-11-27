// A stand-in for the error tracker, on this machine, for the error-reports
// journey: it accepts what the websites' error-report SDK sends and keeps it,
// so the journey can read exactly what would have reached the tracker. It
// never forwards anything. (packages/next-kit/src/error-reports/standin.ts is
// the same for the unit tests.)
//
// Run on its own it listens on ERROR_TRACKER_PORT and appends every envelope
// to the file named by ERROR_TRACKER_LOG, one JSON line each; the journey
// reads that file. Not a journey itself (it lives outside journeys/).

const { createServer } = require("node:http");
const { appendFileSync } = require("node:fs");
const { gunzipSync } = require("node:zlib");

/** A Sentry envelope: a header line, then pairs of item header and payload lines. */
function parseEnvelope(body) {
  const lines = body.split("\n").filter((line) => line.length > 0);
  const items = [];
  for (let i = 1; i < lines.length; i += 2) {
    let header = {};
    let payload = lines[i + 1] ?? null;
    try {
      header = JSON.parse(lines[i]);
    } catch {}
    try {
      payload = JSON.parse(payload);
    } catch {}
    items.push({ header, payload });
  }
  return items;
}

function startStandIn(port, onArrival) {
  const server = createServer((request, response) => {
    // The browser asks first when it may post (it usually does not need to).
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors);
      response.end();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let raw = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
      const body = raw.toString("utf8");
      const [path, query = ""] = (request.url || "").split("?");
      onArrival({
        at: new Date().toISOString(),
        path,
        query,
        origin: request.headers.origin || null,
        cookie: request.headers.cookie || null,
        body,
        items: parseEnvelope(body),
      });
      response.writeHead(200, { ...cors, "content-type": "application/json" });
      response.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

module.exports = { startStandIn, parseEnvelope };

if (require.main === module) {
  const port = Number(process.env.ERROR_TRACKER_PORT);
  const log = process.env.ERROR_TRACKER_LOG;
  if (!port || !log) {
    console.error("Set ERROR_TRACKER_PORT and ERROR_TRACKER_LOG.");
    process.exit(2);
  }
  startStandIn(port, (arrival) => appendFileSync(log, `${JSON.stringify(arrival)}\n`)).then(() =>
    console.log(`error tracker stand-in on http://127.0.0.1:${port}, writing ${log}`),
  );
}
