/*
 * Family J: the support desk (20261121084700_support_cases.sql) against the
 * Atención functions and the account deletion that write the same rows.
 *
 *   node race-j-support-desk.cjs <database-url> [rounds] [scenario-regex]
 *
 * Lock order the desk promises: the customer's account row (key share, only
 * ops_answer_case, as delete_my_account takes it first), then a complaint's
 * row, then the case's row; the trigger behind ops_resolve_complaint and the
 * return decision take the source row and then the case.
 *
 *   J1 ops_answer_case against ops_resolve_complaint on the same complaint.
 *   J2 ops_reopen_case against ops_answer_case on a closed complaint's case.
 *   J3 two answers to one case at once, neither closing: both kept, in the
 *      order they committed, the complaint holding the later one.
 *   J3b two answers that both close: one wins, the other is refused
 *      (case_closed), the case is closed once.
 *   J4 assigning against answering.
 *   J5 the shopper deleting their account against an answer to their recorded
 *      contact: the answer is erased with the account or refused after it,
 *      and the contact ends closed.
 *   J6 a return decision with a note (ops_decide_return) against an answer on
 *      that return's case.
 *
 * Every scenario: no deadlock, no lost or doubled entry, and the source row's
 * status and the case's status agree afterwards.
 *
 * "forced": a third session holds the case row FOR SHARE (or the complaint
 * row in J1b), so the first writer takes what comes before it and waits; the
 * second starts 40 ms later. A wrong lock order deadlocks every forced round.
 */
"use strict";
const { main, STAFF } = require("./lib.cjs");

const ANSWER_A = "Respuesta A de la carrera nueve, desde Casos.";
const ANSWER_B = "Respuesta B de la carrera nueve, desde Atención.";

let serial = 0;

/** A complaint of a harness shopper, opened by the trigger with its case. */
async function complaint(h, status = "open") {
  const row = (
    await h.q(
      `insert into public.complaints (user_id, category, description, status, resolution, resolved_at)
       select id, 'other', 'Queja de la carrera nueve, sin pedido.', 'open', null, null
         from auth.users where email = 'carrera-w7-1@yuntera.example'
       returning id`,
    )
  ).rows[0];
  const kase = (await h.q("select id from private.cases where complaint_id = $1", [row.id]))
    .rows[0];
  if (status === "resolved") {
    await h.call(STAFF, "select public.ops_answer_case($1, $2, true)", [kase.id, ANSWER_A]);
  }
  return { complaint: row.id, kase: kase.id };
}

/** What the case and its complaint say now. */
async function state(h, ctx) {
  const c = (
    await h.q(
      `select k.status as case_status, x.status as complaint_status, x.resolution,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'answer') as answers,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'closed') as closings,
              (select array_agg(e.body order by e.id) from private.case_entries e
                where e.case_id = k.id and e.kind = 'answer') as bodies
         from private.cases k left join public.complaints x on x.id = k.complaint_id where k.id = $1`,
      [ctx.kase],
    )
  ).rows[0];
  return c;
}

const lockLost = (r) => r.outcome === "DEADLOCK" || r.outcome === "SERIALIZATION";

/** Outcomes allowed beside "ok"; anything else is wrong. */
function refusals(results, allowed) {
  const bad = [];
  for (const r of results) {
    if (!r.outcome || lockLost(r)) continue;
    if (!(allowed[r.name] || []).includes(r.outcome)) bad.push(`${r.name} refused: ${r.outcome}`);
  }
  return bad;
}

/** The complaint and its case agree; every successful answer is on the timeline once. */
function agree(s, expectedAnswers) {
  const bad = [];
  if ((s.case_status === "closed") !== (s.complaint_status === "resolved"))
    bad.push(`case ${s.case_status} but complaint ${s.complaint_status}`);
  if (s.answers !== expectedAnswers)
    bad.push(`${s.answers} answers on the timeline, ${expectedAnswers} expected`);
  if (s.closings > 1) bad.push(`closed ${s.closings} times`);
  const last = (s.bodies || [])[(s.bodies || []).length - 1];
  if (last && s.resolution !== last) bad.push("the complaint does not hold the last answer");
  return bad;
}

const natural = (actors) => (h, ctx, round) =>
  actors(h, ctx, round).map((a, i) => ({
    ...a,
    delayMs: (round % 2 === 0) === (i === 1) ? Math.floor(round / 2) % 4 : 0,
  }));
const forced = (actors, late) => (h, ctx, round) =>
  actors(h, ctx, round).map((a, i) => ({ ...a, delayMs: i === late ? 40 : 0 }));
const holdCase = (_h, ctx) => ({
  hold: { sql: "select 1 from private.cases where id = $1 for share", args: [ctx.kase] },
  holdMs: 150,
});
const holdComplaint = (_h, ctx) => ({
  hold: { sql: "select 1 from public.complaints where id = $1 for share", args: [ctx.complaint] },
  holdMs: 150,
});

function pair(name, setup, actors, verify) {
  return [
    { name: `${name} natural`, setup, actors: natural(actors), verify },
    {
      name: `${name} forced, case held, first starts first`,
      setup,
      actors: forced(actors, 1),
      options: holdCase,
      verify,
    },
    {
      name: `${name} forced, case held, second starts first`,
      setup,
      actors: forced(actors, 0),
      options: holdCase,
      verify,
    },
  ];
}

// ── J1 ──────────────────────────────────────────────────────────────────────
const j1 = (_h, ctx, round) => [
  {
    name: "answer",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, $3)",
    args: [ctx.kase, ANSWER_A, round % 4 === 1 || round % 4 === 3],
  },
  {
    name: "resolve",
    as: STAFF,
    sql: "select public.ops_resolve_complaint($1, $2, $3)",
    args: [ctx.complaint, ANSWER_B, round % 4 === 0 || round % 4 === 3],
  },
];
async function verifyJ1(h, ctx, results) {
  const bad = refusals(results, { answer: ["case_closed"], resolve: ["complaint_not_found"] });
  const s = await state(h, ctx);
  const ok = results.filter((r) => !r.outcome).length;
  return [...bad, ...agree(s, ok)];
}

// ── J2 ──────────────────────────────────────────────────────────────────────
const j2 = (_h, ctx) => [
  { name: "reopen", as: STAFF, sql: "select public.ops_reopen_case($1)", args: [ctx.kase] },
  {
    name: "answer",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, false)",
    args: [ctx.kase, ANSWER_B],
  },
];
async function verifyJ2(h, ctx, results) {
  const bad = refusals(results, { answer: ["case_closed"] });
  const reopen = results.find((r) => r.name === "reopen");
  const answer = results.find((r) => r.name === "answer");
  if (reopen.outcome && !lockLost(reopen)) bad.push(`reopen refused: ${reopen.outcome}`);
  const s = await state(h, ctx);
  // The setup's closing answer, plus the second one when it got in.
  bad.push(...agree(s, 1 + (answer.outcome ? 0 : 1)));
  if (!reopen.outcome && s.case_status !== "open")
    bad.push(`reopened, but the case is ${s.case_status}`);
  return bad;
}

// ── J3 ──────────────────────────────────────────────────────────────────────
const j3 = (close) => (_h, ctx) => [
  {
    name: "answer-a",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, $3)",
    args: [ctx.kase, ANSWER_A, close],
  },
  {
    name: "answer-b",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, $3)",
    args: [ctx.kase, ANSWER_B, close],
  },
];
async function verifyJ3(h, ctx, results) {
  const bad = refusals(results, {});
  const s = await state(h, ctx);
  bad.push(...agree(s, results.filter((r) => !r.outcome).length));
  if (results.every((r) => !r.outcome) && s.answers !== 2) bad.push("an answer was lost");
  return bad;
}
async function verifyJ3b(h, ctx, results) {
  const bad = refusals(results, { "answer-a": ["case_closed"], "answer-b": ["case_closed"] });
  const s = await state(h, ctx);
  const ok = results.filter((r) => !r.outcome).length;
  if (results.every((r) => !lockLost(r)) && ok !== 1) bad.push(`${ok} closing answers got in`);
  if (s.case_status !== "closed" || s.closings !== 1) bad.push(`closed ${s.closings} times`);
  bad.push(...agree(s, ok));
  return bad;
}

// ── J4 ──────────────────────────────────────────────────────────────────────
const j4 = (_h, ctx) => [
  { name: "assign", as: STAFF, sql: "select public.ops_assign_case($1)", args: [ctx.kase] },
  {
    name: "answer",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, false)",
    args: [ctx.kase, ANSWER_A],
  },
];
async function verifyJ4(h, ctx, results) {
  const bad = refusals(results, {});
  const s = await state(h, ctx);
  bad.push(...agree(s, results.find((r) => r.name === "answer").outcome ? 0 : 1));
  const assigned = (
    await h.q(
      `select count(*)::int as n, (select assignee_id from private.cases where id = $1) as who
         from private.case_entries where case_id = $1 and kind = 'assigned'`,
      [ctx.kase],
    )
  ).rows[0];
  if (!results.find((r) => r.name === "assign").outcome && assigned.n !== 1)
    bad.push(`${assigned.n} assignment entries`);
  if (!results.find((r) => r.name === "assign").outcome && !assigned.who)
    bad.push("assigned to nobody");
  return bad;
}

// ── J5 ──────────────────────────────────────────────────────────────────────
async function setupJ5(h) {
  serial += 1;
  const email = `carrera-j5-${Date.now().toString(36)}-${serial}@yuntera.example`;
  const user = (
    await h.q(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (gen_random_uuid(), $1, '{"full_name": "Prueba Carrera Nueve"}') returning id`,
      [email],
    )
  ).rows[0].id;
  h.ids.set(email, user);
  // A customer: a complaint already answered (an open one would hold the deletion back).
  await h.q(
    `insert into public.complaints (user_id, category, description, status, resolution, resolved_at)
     values ($1, 'other', 'Queja vieja de la carrera nueve.', 'resolved', 'Ya le respondimos.', now())`,
    [user],
  );
  const kase = (
    await h.call(STAFF, "select public.ops_record_contact('phone', 'other', $1, null, $2) as id", [
      "Pregunta de la carrera nueve por teléfono.",
      user,
    ])
  ).id;
  await h.call(STAFF, "select public.ops_add_case_note($1, $2)", [
    kase,
    "Nota de la carrera nueve.",
  ]);
  return { email, user, kase };
}
const j5 = (_h, ctx) => [
  { name: "delete", as: ctx.email, sql: "select public.delete_my_account()", args: [] },
  {
    name: "answer",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, false)",
    args: [ctx.kase, ANSWER_A],
  },
];
async function verifyJ5(h, ctx, results) {
  const bad = refusals(results, { answer: ["case_account_deleted", "case_closed"] });
  const del = results.find((r) => r.name === "delete");
  if (del.outcome && !lockLost(del)) bad.push(`deletion refused: ${del.outcome}`);
  const s = (
    await h.q(
      `select k.status, k.summary,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind in ('note', 'answer')
                 and e.body is distinct from private.erased_case_text()) as kept,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'answer') as answers
         from private.cases k where k.id = $1`,
      [ctx.kase],
    )
  ).rows[0];
  const answered = !results.find((r) => r.name === "answer").outcome;
  if (!del.outcome) {
    if (s.kept !== 0) bad.push(`${s.kept} texts kept after the account was deleted`);
    if (s.status !== "closed") bad.push(`the deleted account's contact is ${s.status}`);
  }
  if (s.answers !== (answered ? 1 : 0))
    bad.push(`${s.answers} answers, answer ${answered ? "ok" : "refused"}`);
  return bad;
}

// ── J6 ──────────────────────────────────────────────────────────────────────
async function setupJ6(h) {
  // A request to decide on a delivered line of the demo shopper, made as the
  // owner (the API's limits on how many a shopper may open are not under test).
  const line = (
    await h.q(
      `select i.id, o.user_id from public.order_items i join public.orders o on o.id = i.order_id
         join auth.users u on u.id = o.user_id
        where u.email = 'comprador@yuntera.example' and o.status = 'delivered'
        order by o.placed_at desc, i.id limit 1`,
    )
  ).rows[0];
  await h.q(
    "delete from public.return_requests where order_item_id = $1 and reason = 'Carrera nueve.'",
    [line.id],
  );
  const ret = (
    await h.q(
      `insert into public.return_requests (order_item_id, user_id, kind, quantity, reason, status)
       values ($1, $2, 'damaged', 1, 'Carrera nueve.', 'requested') returning id`,
      [line.id, line.user_id],
    )
  ).rows[0].id;
  const kase = (await h.q("select id from private.cases where return_id = $1", [ret])).rows[0].id;
  return { ret, kase };
}
const j6 = (_h, ctx) => [
  {
    name: "decide",
    as: STAFF,
    sql: "select public.ops_decide_return($1, false, $2)",
    args: [ctx.ret, "No vemos el daño en las fotos de la carrera."],
  },
  {
    name: "answer",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, false)",
    args: [ctx.kase, ANSWER_A],
  },
];
async function verifyJ6(h, ctx, results) {
  const bad = refusals(results, { answer: ["case_closed"] });
  const decide = results.find((r) => r.name === "decide");
  if (decide.outcome && !lockLost(decide)) bad.push(`decision refused: ${decide.outcome}`);
  const s = (
    await h.q(
      `select k.status as case_status, r.status as return_status,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'answer') as answers,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'closed') as closings
         from private.cases k join public.return_requests r on r.id = k.return_id where k.id = $1`,
      [ctx.kase],
    )
  ).rows[0];
  if ((s.case_status === "closed") !== (s.return_status === "rejected"))
    bad.push(`case ${s.case_status} but return ${s.return_status}`);
  const expected =
    (decide.outcome ? 0 : 1) + (results.find((r) => r.name === "answer").outcome ? 0 : 1);
  if (s.answers !== expected) bad.push(`${s.answers} answers, ${expected} expected`);
  if (s.closings > 1) bad.push(`closed ${s.closings} times`);
  return bad;
}

const scenarios = [
  ...pair("J1 ops_answer_case vs ops_resolve_complaint", (h) => complaint(h), j1, verifyJ1),
  {
    name: "J1b ops_answer_case vs ops_resolve_complaint forced, complaint held",
    setup: (h) => complaint(h),
    actors: forced(j1, 1),
    options: holdComplaint,
    verify: verifyJ1,
  },
  ...pair("J2 ops_reopen_case vs ops_answer_case", (h) => complaint(h, "resolved"), j2, verifyJ2),
  ...pair("J3 two answers to one case", (h) => complaint(h), j3(false), verifyJ3),
  ...pair("J3b two closing answers to one case", (h) => complaint(h), j3(true), verifyJ3b),
  ...pair("J4 ops_assign_case vs ops_answer_case", (h) => complaint(h), j4, verifyJ4),
  ...pair("J5 delete_my_account vs ops_answer_case", setupJ5, j5, verifyJ5),
  ...pair("J6 ops_decide_return with a note vs ops_answer_case", setupJ6, j6, verifyJ6),
];

module.exports = { scenarios, setupJ5, j5, verifyJ5, complaint, j1, verifyJ1 };

if (require.main === module) {
  main("J", scenarios).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
