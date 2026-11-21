// Runs with Node's own test runner (`pnpm test` here): the app has no test
// framework of its own, and these rules need none.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPutawayBin,
  isToDo,
  nextTask,
  parsePack,
  parsePicked,
  parseReceive,
  pendingTasks,
  pendingUnits,
  pickProgress,
  plural,
  sortBoard,
} from "./floor";

const task = (task_id: string, status: string, quantity = 1, picked_quantity = 0) => ({
  task_id,
  status: status as "open" | "in_progress" | "done" | "short" | "cancelled",
  quantity,
  picked_quantity,
});

describe("the board", () => {
  it("lists parcels in picking first, then waiting, then packed, then at dispatch", () => {
    const sorted = sortBoard([
      { id: 1, status: "packed" as const },
      { id: 2, status: "pending" as const },
      { id: 3, status: "ready_for_dispatch" as const },
      { id: 4, status: "picking" as const },
      { id: 5, status: "pending" as const },
    ]);
    assert.deepEqual(
      sorted.map((s) => s.id),
      [4, 2, 5, 1, 3],
    );
  });

  it("counts as to do only what is waiting or in picking", () => {
    assert.equal(isToDo({ status: "pending" }), true);
    assert.equal(isToDo({ status: "picking" }), true);
    assert.equal(isToDo({ status: "packed" }), false);
  });

  it("writes one and many", () => {
    assert.equal(plural(1, "unidad", "unidades"), "1 unidad");
    assert.equal(plural(3, "unidad", "unidades"), "3 unidades");
  });
});

describe("a pick list", () => {
  it("counts lines done out of all of them", () => {
    assert.deepEqual(pickProgress([task("a", "done"), task("b", "open"), task("c", "short")]), {
      done: 1,
      total: 3,
      short: true,
      allPicked: false,
    });
    assert.equal(pickProgress([task("a", "done"), task("b", "done")]).allPicked, true);
    assert.equal(pickProgress([]).allPicked, false);
  });

  it("goes to the first line not picked, in walking order", () => {
    const tasks = [task("a", "done"), task("b", "short"), task("c", "open"), task("d", "open")];
    assert.equal(nextTask(tasks)?.task_id, "c");
  });

  it("keeps the line the worker chose while it still needs work", () => {
    const tasks = [task("a", "open"), task("b", "open")];
    assert.equal(nextTask(tasks, "b")?.task_id, "b");
    assert.equal(nextTask([task("a", "open"), task("b", "done")], "b")?.task_id, "a");
  });

  it("comes back to a short line only when nothing else is left", () => {
    assert.equal(nextTask([task("a", "done"), task("b", "short")])?.task_id, "b");
    assert.equal(nextTask([task("a", "done")]), null);
  });

  it("lists the lines still to do", () => {
    const tasks = [
      task("a", "done"),
      task("b", "short"),
      task("c", "open"),
      task("d", "cancelled"),
    ];
    assert.deepEqual(
      pendingTasks(tasks).map((t) => t.task_id),
      ["b", "c"],
    );
  });
});

describe("form checks, with the web's words", () => {
  it("takes 0 up to the quantity asked", () => {
    assert.deepEqual(parsePicked("2", 2), { quantity: 2 });
    assert.deepEqual(parsePicked(" 0 ", 2), { quantity: 0 });
    for (const bad of ["", "3", "-1", "1.5", "dos"]) {
      assert.deepEqual(parsePicked(bad, 2), { error: "Escriba cuántas unidades tomó." });
    }
  });

  it("asks for a weight from 1 g to 30 kg and 1 to 20 parcels", () => {
    assert.deepEqual(parsePack("1200", ""), { weightGrams: 1200, packageCount: 1 });
    assert.deepEqual(parsePack("1200", "2"), { weightGrams: 1200, packageCount: 2 });
    for (const [w, p] of [
      ["", "1"],
      ["0", "1"],
      ["30001", "1"],
      ["500", "0"],
      ["500", "21"],
      ["5,5", "1"],
    ]) {
      assert.deepEqual(parsePack(w as string, p as string), {
        error: "Escriba el peso en gramos y cuántos bultos son.",
      });
    }
  });

  it("receives good and damaged units into a chosen bin", () => {
    assert.deepEqual(parseReceive({ good: "10", damaged: "1", locationId: "bin", pending: 12 }), {
      goodQuantity: 10,
      damagedQuantity: 1,
      locationId: "bin",
    });
    assert.deepEqual(parseReceive({ good: "", damaged: "2", locationId: "bin", pending: 12 }), {
      goodQuantity: 0,
      damagedQuantity: 2,
      locationId: "bin",
    });
    assert.deepEqual(parseReceive({ good: "1", damaged: "0", locationId: null, pending: 12 }), {
      error: "Elija dónde lo guarda.",
    });
    assert.deepEqual(parseReceive({ good: "0", damaged: "", locationId: "bin", pending: 12 }), {
      error: "Indique cuántas unidades recibió.",
    });
  });

  it("does not record more than is still to receive until the worker confirms it", () => {
    const count = { good: "120", damaged: "0", locationId: "bin", pending: 12 };
    assert.deepEqual(parseReceive(count), { surplus: 108 });
    assert.deepEqual(parseReceive({ ...count, good: "11", damaged: "2" }), { surplus: 1 });
    assert.deepEqual(parseReceive({ ...count, surplusConfirmed: true }), {
      goodQuantity: 120,
      damagedQuantity: 0,
      locationId: "bin",
    });
    assert.deepEqual(parseReceive({ ...count, good: "12" }), {
      goodQuantity: 12,
      damagedQuantity: 0,
      locationId: "bin",
    });
  });

  it("caps each count as the web does", () => {
    const count = { damaged: "0", locationId: "bin", pending: 200_000, surplusConfirmed: true };
    assert.deepEqual(parseReceive({ ...count, good: "100001" }), {
      error: "Indique cuántas unidades recibió.",
    });
    assert.equal("goodQuantity" in parseReceive({ ...count, good: "100000" }), true);
  });

  it("knows what is left of an inbound line and where it can go", () => {
    assert.equal(pendingUnits({ line_id: "l", expected: 12, received: 10, damaged: 1 }), 1);
    assert.equal(pendingUnits({ line_id: "l", expected: 5, received: 6, damaged: 0 }), 0);
    assert.equal(isPutawayBin({ kind: "receiving" }), true);
    assert.equal(isPutawayBin({ kind: "storage" }), true);
    assert.equal(isPutawayBin({ kind: "pick" }), false);
  });
});
