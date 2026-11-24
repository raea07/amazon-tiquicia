/*
 * Checks the harness's database guard (lib.cjs: localUrl, laneDatabase,
 * poolConfig): every URL that could reach anything but a lane's own local
 * database is refused, before any connection is made.
 *
 *   node tools/races/guard-check.cjs
 *
 * Exits 1 and names the URL when the guard accepts one it must refuse, or
 * refuses one it must accept. run-all.sh runs it first.
 */
"use strict";
const { localUrl, laneDatabase, poolConfig } = require("./lib.cjs");

const accepted = (url) => localUrl(url).ok && laneDatabase(url);
const LOCAL = "postgres://postgres:postgres@127.0.0.1:5432";
const mustAccept = [
  `${LOCAL}/yuntera_lane12`,
  `${LOCAL}/yuntera_lane15`,
  `${LOCAL}/yuntera_lane12_pre`,
  "postgresql://postgres:postgres@localhost:5432/yuntera_lane1",
  "postgres://postgres@127.0.0.1/yuntera_lane19",
];
const mustRefuse = [
  `${LOCAL}/yuntera_local`,
  `${LOCAL}/yuntera_lane0`,
  `${LOCAL}/yuntera_lane20`,
  `${LOCAL}/postgres`,
  "postgres://postgres:postgres@db.example.com:5432/yuntera_lane12",
  "postgres://postgres:postgres@127.0.0.1.example.com:5432/yuntera_lane12",
  // node-postgres honours connection parameters in the query string, which
  // would override the host the guard checked.
  `${LOCAL}/yuntera_lane12?host=192.0.2.1&connect_timeout=2`,
  `${LOCAL}/yuntera_lane12?host=/var/run/nonexistent`,
  `${LOCAL}/yuntera_lane12?hostaddr=192.0.2.1`,
  `${LOCAL}/yuntera_lane12?port=6543`,
  `${LOCAL}/yuntera_lane12?dbname=yuntera_local`,
  `${LOCAL}/yuntera_lane12?options=-c%20search_path%3Dx`,
  `${LOCAL}/yuntera_lane12?`,
  `${LOCAL}/yuntera_lane12#x`,
  "mysql://postgres:postgres@127.0.0.1:5432/yuntera_lane12",
  "not a url",
  "",
];

let bad = 0;
for (const url of mustAccept) {
  if (!accepted(url)) {
    process.stderr.write(`guard refuses a lane database it must accept: ${url}\n`);
    bad++;
  } else {
    const c = poolConfig(url);
    if (!["127.0.0.1", "localhost"].includes(c.host) || !/^yuntera_lane/.test(c.database)) {
      process.stderr.write(
        `pool settings do not follow the checked URL: ${url} -> ${JSON.stringify(c)}\n`,
      );
      bad++;
    }
  }
}
for (const url of mustRefuse) {
  if (accepted(url)) {
    process.stderr.write(`guard accepts a URL it must refuse: ${url}\n`);
    bad++;
  }
  let threw = false;
  try {
    poolConfig(url);
  } catch {
    threw = true;
  }
  if (!threw) {
    process.stderr.write(`poolConfig builds settings for a URL it must refuse: ${url}\n`);
    bad++;
  }
}
if (bad) process.exit(1);
process.stdout.write(
  `guard-check: ${mustAccept.length} accepted, ${mustRefuse.length} refused, as expected\n`,
);
