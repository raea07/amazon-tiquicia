import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, type DriverDay } from "@yuntera/db";
import { createOfflineQueue, type QueueEntry } from "@yuntera/expo-kit/offline";
import {
  ageLimit,
  type DriverCalls,
  expiredMessage,
  MOVED_STOP_MESSAGE,
  POSITION_MAX_AGE_MS,
  sendWith,
} from "./send";

const refused = (code: string) => new ApiError(code as ApiError["code"], { status: 400 });

/** A server holding one stop, answering the driver's calls the way the database does. */
function fakeServer(initial: { status: string; failure_reason?: string | null }) {
  const stop = { stop_id: "s1", failure_reason: null as string | null, ...initial };
  const log: string[] = [];
  let mode: "up" | "down" | "suspended" = "up";
  const guard = () => {
    if (mode === "down") throw new ApiError("network");
    if (mode === "suspended") throw refused("forbidden");
  };
  const api: DriverCalls = {
    driverToday: async () => {
      guard();
      return { driver: {}, routes: [{ stops: [stop] }] } as unknown as DriverDay;
    },
    driverArrive: async (stopId) => {
      guard();
      log.push(`arrive:${stopId}`);
      if (stop.status !== "pending") throw refused("stop_not_found");
      stop.status = "arrived";
    },
    driverFailStop: async (input) => {
      guard();
      log.push(`fail:${input.stopId}:${input.reason}`);
      if (stop.status !== "pending" && stop.status !== "arrived") {
        throw refused("invalid_stop_state");
      }
      stop.status = "failed";
      stop.failure_reason = input.reason;
      return { ok: true as const, route_completed: false };
    },
    driverReportPosition: async () => {
      guard();
      log.push("position");
    },
  };
  return {
    api,
    log,
    stop,
    set mode(next: typeof mode) {
      mode = next;
    },
  };
}

const entry = (kind: string, payload: unknown): QueueEntry => ({
  id: "e1",
  owner: "carlos",
  kind,
  payload,
  createdAt: 0,
  status: "sending",
  attempts: 0,
});

const failure = (reason: string) => entry("fail", { stopId: "s1", reason, lat: null, lng: null });

function sender(api: DriverCalls) {
  const refusals: string[] = [];
  const send = sendWith(api, {
    messageOf: (error) => `mensaje:${error instanceof ApiError ? error.code : "?"}`,
    onRefused: (error) => refusals.push(error.code),
  });
  return { send, refusals };
}

describe("sending a queued arrival", () => {
  it("counts a refused repeat as done when the stop is already past pending", async () => {
    const server = fakeServer({ status: "arrived" });
    const { send } = sender(server.api);
    assert.deepEqual(await send(entry("arrive", { stopId: "s1" })), { result: "done" });
  });

  it("waits, and asks nothing of the server, when there is no signal", async () => {
    const server = fakeServer({ status: "pending" });
    server.mode = "down";
    const { send, refusals } = sender(server.api);
    assert.deepEqual(await send(entry("arrive", { stopId: "s1" })), { result: "offline" });
    assert.deepEqual(refusals, []);
  });
});

describe("sending a queued failed delivery", () => {
  it("counts the same failure sent twice as done", async () => {
    const server = fakeServer({ status: "failed", failure_reason: "nobody_home" });
    const { send } = sender(server.api);
    assert.deepEqual(await send(failure("nobody_home")), { result: "done" });
  });

  it("does not claim a reason was recorded when the stop already failed with another", async () => {
    const server = fakeServer({ status: "failed", failure_reason: "nobody_home" });
    const { send } = sender(server.api);
    assert.deepEqual(await send(failure("damaged")), {
      result: "rejected",
      message:
        "Esta parada ya estaba registrada como no entregada, con el motivo «No había nadie». No se cambió.",
    });
    assert.equal(server.stop.failure_reason, "nobody_home");
  });

  it("is refused, with a message, on a stop already delivered", async () => {
    const server = fakeServer({ status: "delivered" });
    const { send } = sender(server.api);
    const outcome = await send(failure("refused"));
    assert.equal(outcome.result, "rejected");
    assert.match(
      outcome.result === "rejected" ? outcome.message : "",
      /ya figuraba como entregada/,
    );
  });
});

describe("a stop Central moved to another route", () => {
  // A driver suspended and active again: their unfinished stops went to a new
  // route for dispatch, so what was queued for them is refused and reported.
  const moved: DriverCalls = {
    driverToday: async () => ({ driver: {}, routes: [] }) as unknown as DriverDay,
    driverArrive: async () => {
      throw refused("stop_not_found");
    },
    driverFailStop: async () => {
      throw refused("stop_not_found");
    },
    driverReportPosition: async () => undefined,
  };

  it("reports a queued arrival as not recorded, and says to tell Central", async () => {
    const { send } = sender(moved);
    assert.deepEqual(await send(entry("arrive", { stopId: "s1" })), {
      result: "rejected",
      message: MOVED_STOP_MESSAGE,
    });
  });

  it("reports a queued failure the same way", async () => {
    const { send } = sender(moved);
    assert.deepEqual(await send(failure("nobody_home")), {
      result: "rejected",
      message: MOVED_STOP_MESSAGE,
    });
    assert.match(MOVED_STOP_MESSAGE, /Avise a Central/);
  });
});

describe("a driver whose access was withdrawn", () => {
  it("has a refused position reported to the app, so it checks access again", async () => {
    const server = fakeServer({ status: "pending" });
    server.mode = "suspended";
    const { send, refusals } = sender(server.api);
    // Nothing for the driver to do about one position: it leaves the queue…
    assert.deepEqual(await send(entry("position", { lat: 9.9, lng: -84, accuracy: 10 })), {
      result: "done",
    });
    // …but the app hears of the refusal.
    assert.deepEqual(refusals, ["forbidden"]);
  });

  it("has refused stop actions reported too", async () => {
    const server = fakeServer({ status: "pending" });
    server.mode = "suspended";
    const { send, refusals } = sender(server.api);
    await send(entry("arrive", { stopId: "s1" }));
    await send(failure("other"));
    assert.deepEqual(refusals, ["forbidden", "forbidden"]);
  });
});

describe("the drivers' queue, end to end with the fake server", () => {
  function store() {
    const map = new Map<string, string>();
    return {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: async (key: string) => {
        map.delete(key);
      },
    };
  }

  it("sends an arrival and a failure once each, in order, after the signal returns", async () => {
    const server = fakeServer({ status: "pending" });
    const time = { now: 1_000_000 };
    const queue = createOfflineQueue({
      store: store(),
      key: "q",
      repeatable: () => true,
      maxAgeMs: ageLimit,
      expiredMessage,
      now: () => time.now,
    });
    await queue.setOwner("carlos");
    await queue.enqueue("arrive", { stopId: "s1" });
    await queue.enqueue("fail", { stopId: "s1", reason: "nobody_home", lat: null, lng: null });
    await queue.enqueue("position", { lat: 9.9, lng: -84, accuracy: 10 }, { coalesce: "position" });
    const { send } = sender(server.api);

    server.mode = "down";
    await queue.flush(send);
    assert.equal(queue.snapshot().pending, 3);

    // Back after longer than a position is worth: it is dropped, the stop actions are not.
    time.now += POSITION_MAX_AGE_MS + 1;
    server.mode = "up";
    await queue.flush(send);
    await queue.flush(send);
    assert.deepEqual(server.log, ["arrive:s1", "fail:s1:nobody_home"]);
    assert.equal(queue.snapshot().entries.length, 0);
  });

  it("reports a stop action that waited more than a day and a half, never sending it", async () => {
    const server = fakeServer({ status: "pending" });
    const time = { now: 1_000_000 };
    const queue = createOfflineQueue({
      store: store(),
      key: "q",
      maxAgeMs: ageLimit,
      expiredMessage,
      now: () => time.now,
    });
    await queue.setOwner("carlos");
    await queue.enqueue("arrive", { stopId: "s1" });
    time.now += 37 * 60 * 60 * 1000;
    await queue.flush(sender(server.api).send);
    assert.deepEqual(server.log, []);
    const [left] = queue.snapshot().entries;
    assert.equal(left?.status, "rejected");
    assert.match(left?.message ?? "", /Avise a Central/);
  });
});
