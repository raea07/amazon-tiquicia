/*
 * Family J: the support desk (20261121084700_support_cases.sql) against the
 * Atención functions and the account deletion that write the same rows.
 *
 *   node race-j-support-desk.cjs <database-url> [rounds] [scenario-regex]
 *
 * Lock order the desk promises: the customer's account row (key share, in
 * ops_answer_case, ops_reopen_case and ops_record_contact, as
 * delete_my_account takes it first), then a complaint's row, then the case's
 * row; the trigger behind ops_resolve_complaint and the return decision take
 * the source row and then the case.
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
 *   J7 the shopper deleting their account against staff recording a new
 *      contact for them: the contact is refused after the deletion, or made
 *      before it and then erased and closed with the account; never left
 *      open with its summary. Forced: the shopper's old complaint is held, so
 *      the deletion holds the account row while the contact is recorded.
 *   J8 one staff member's texts at once: ten contacts recorded in parallel
 *      by one fresh writer, each with five four-digit numbers (J8a) or with
 *      the order's live delivery code among them (J8b). The hourly allowance
 *      (20 numbers) and the lock-out (3 refusals) hold: at most 20 numbers
 *      counted and at most 3 refusals on the audit trail, whatever the
 *      interleaving (084700 checks one writer's texts one after another).
 *   J9 the shopper deleting their account against staff reopening their
 *      closed complaint's case: the reopening is refused after the deletion
 *      (case_account_deleted) or the deletion is refused after the reopening
 *      (account_has_open_complaints); never an open case on a deleted
 *      account. Before ops_reopen_case took the account row first, 28 of 30
 *      rounds (natural and both forced) left exactly that.
 *   J10 the deletion against an answer on the shopper's open report (a
 *      deletion leaves a report's case open): the answer is refused after
 *      it, or written before it and erased with the account.
 *   J11 the deletion against assigning the shopper's open recorded contact:
 *      the contact ends closed, the assignment written once or refused
 *      (case_closed).
 *   J9 to J11 forced: "deletion under way" holds the shopper's profile row,
 *   so the deletion holds the account row and waits; "staff first" holds the
 *   case row, so the staff call holds what comes before it and waits.
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

/** Staff texts a deleted account's complaints, returns and reports still hold (none expected). */
async function sourceTextsKept(h, user) {
  return (
    await h.q(
      `select (select count(*)::int from public.complaints x where x.user_id = $1
                 and x.resolution is distinct from private.erased_case_text() and x.resolution is not null)
            + (select count(*)::int from public.return_requests r where r.user_id = $1
                 and r.resolution_note is distinct from private.erased_case_text() and r.resolution_note is not null)
            + (select count(*)::int from public.content_reports r where r.reporter_id = $1
                 and r.resolution is distinct from private.erased_case_text() and r.resolution is not null) as n`,
      [user],
    )
  ).rows[0].n;
}

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
    const source = await sourceTextsKept(h, ctx.user);
    if (source !== 0) bad.push(`${source} staff texts kept on the complaints after the deletion`);
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

// ── J7 ──────────────────────────────────────────────────────────────────────
async function setupJ7(h) {
  serial += 1;
  const email = `carrera-j7-${Date.now().toString(36)}-${serial}@yuntera.example`;
  const user = (
    await h.q(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (gen_random_uuid(), $1, '{"full_name": "Prueba Carrera Siete"}') returning id`,
      [email],
    )
  ).rows[0].id;
  h.ids.set(email, user);
  const complaint = (
    await h.q(
      `insert into public.complaints (user_id, category, description, status, resolution, resolved_at)
       values ($1, 'other', 'Queja vieja de la carrera siete.', 'resolved', 'Ya le respondimos.', now())
       returning id`,
      [user],
    )
  ).rows[0].id;
  return { email, user, complaint };
}
const j7 = (_h, ctx) => [
  { name: "delete", as: ctx.email, sql: "select public.delete_my_account()", args: [] },
  {
    name: "record",
    as: STAFF,
    sql: "select public.ops_record_contact('phone', 'other', $1, null, $2)",
    args: ["Sofía llamó desde el 8765-4321 por su pedido.", ctx.user],
  },
];
async function verifyJ7(h, ctx, results) {
  const bad = refusals(results, { record: ["case_account_deleted", "customer_not_found"] });
  const del = results.find((r) => r.name === "delete");
  if (del.outcome && !lockLost(del)) bad.push(`deletion refused: ${del.outcome}`);
  const s = (
    await h.q(
      `select count(*)::int as contacts,
              count(*) filter (where k.status = 'open')::int as open,
              count(*) filter (where k.summary is distinct from private.erased_case_text())::int as kept
         from private.cases k where k.user_id = $1 and k.kind = 'contact'`,
      [ctx.user],
    )
  ).rows[0];
  const recorded = !results.find((r) => r.name === "record").outcome;
  if (s.contacts !== (recorded ? 1 : 0))
    bad.push(`${s.contacts} contacts, record ${recorded ? "ok" : "refused"}`);
  if (!del.outcome && (s.open !== 0 || s.kept !== 0))
    bad.push(`after the deletion: ${s.open} open, ${s.kept} with their summary`);
  if (!del.outcome && (await sourceTextsKept(h, ctx.user)) !== 0)
    bad.push("a staff text kept on the complaint after the deletion");
  return bad;
}
const holdOldComplaint = (_h, ctx) => ({
  hold: { sql: "select 1 from public.complaints where id = $1 for share", args: [ctx.complaint] },
  holdMs: 150,
});

// ── J8 ──────────────────────────────────────────────────────────────────────
const J8_CALLS = 10;
async function setupJ8(h) {
  serial += 1;
  const email = `carrera-j8-${Date.now().toString(36)}-${serial}@yuntera.example`;
  const user = (
    await h.q(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (gen_random_uuid(), $1, '{"full_name": "Prueba Carrera Ocho"}') returning id`,
      [email],
    )
  ).rows[0].id;
  await h.q("insert into public.staff_members (user_id, role) values ($1, 'support')", [user]);
  h.ids.set(email, user);
  // Any order with a delivery code: a contact about it may not hold that code.
  const order = (
    await h.q(
      `select o.order_number, c.code from public.orders o
         join private.delivery_codes c on c.order_id = o.id
        order by o.order_number limit 1`,
    )
  ).rows[0];
  if (!order) throw new Error("no order with a delivery code in the seed");
  return { email, user, number: order.order_number, code: order.code };
}
/** Five different four-digit numbers, none of them the code; `withCode` puts the code first. */
function fiveNumbers(code, call, withCode) {
  const out = [];
  for (let n = 1000 + call * 7; out.length < 5; n += 1) {
    const s = String(n);
    if (s !== code && !out.includes(s)) out.push(s);
  }
  if (withCode) out[0] = code;
  return out.join(" y ");
}
const j8 = (withCode) => (_h, ctx) =>
  Array.from({ length: J8_CALLS }, (_, i) => ({
    name: `record-${i}`,
    as: ctx.email,
    sql: "select public.ops_record_contact('phone', 'other', $1, $2, null) as id",
    args: [`Llamada sobre los números ${fiveNumbers(ctx.code, i, withCode)}.`, ctx.number],
  }));
async function verifyJ8(h, ctx, results, withCode) {
  const bad = [];
  const allowed = withCode
    ? ["too_many_refusals", "too_many_numbers_hour"]
    : ["too_many_numbers_hour"];
  for (const r of results) {
    if (!r.outcome || lockLost(r)) continue;
    if (!allowed.some((a) => r.outcome.includes(a))) bad.push(`${r.name} refused: ${r.outcome}`);
  }
  const s = (
    await h.q(
      `select (select coalesce(sum(k.numbers), 0)::int from private.case_number_checks k
                where k.actor_id = $1) as numbers,
              (select count(*)::int from private.audit_log a
                where a.actor_id = $1 and a.action = 'REFUSED_CODE') as refusals,
              (select count(*)::int from private.cases k where k.created_by = $1) as contacts`,
      [ctx.user],
    )
  ).rows[0];
  if (s.numbers > 20) bad.push(`${s.numbers} numbers counted in the hour (allowance 20)`);
  if (s.refusals > 3) bad.push(`${s.refusals} refusals on the trail in the hour (lock-out 3)`);
  const kept = results.filter((r) => !r.outcome && r.row && r.row.id).length;
  const nulls = results.filter((r) => !r.outcome && r.row && !r.row.id).length;
  if (s.contacts !== kept) bad.push(`${s.contacts} contacts recorded, ${kept} answered with an id`);
  if (withCode && (kept !== 0 || nulls !== s.refusals))
    bad.push(
      `${kept} contacts with the code kept, ${nulls} refused against ${s.refusals} on the trail`,
    );
  if (!withCode && kept * 5 !== s.numbers)
    bad.push(`${kept} contacts kept but ${s.numbers} numbers counted`);
  return bad;
}

// ── J9, J10, J11: the account deletion against the other staff writers ──────
/** A fresh shopper of the harness (no orders, so nothing else holds the deletion back). */
async function freshShopper(h, tag) {
  serial += 1;
  const email = `carrera-${tag}-${Date.now().toString(36)}-${serial}@yuntera.example`;
  const user = (
    await h.q(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (gen_random_uuid(), $1, '{"full_name": "Prueba Carrera Borrado"}') returning id`,
      [email],
    )
  ).rows[0].id;
  h.ids.set(email, user);
  return { email, user };
}
/** J9: a complaint of a fresh shopper, answered and closed from Casos. */
async function setupJ9(h) {
  const who = await freshShopper(h, "j9");
  const complaintId = (
    await h.q(
      `insert into public.complaints (user_id, category, description, status)
       values ($1, 'other', 'Queja de la carrera nueve, para reabrir.', 'open') returning id`,
      [who.user],
    )
  ).rows[0].id;
  const kase = (await h.q("select id from private.cases where complaint_id = $1", [complaintId]))
    .rows[0].id;
  await h.call(STAFF, "select public.ops_answer_case($1, $2, true)", [kase, ANSWER_A]);
  return { ...who, complaint: complaintId, kase };
}
/** J10 and J11: an open report of a fresh shopper (a deletion leaves its case open) or an open contact. */
async function setupJ10(h, kind) {
  const who = await freshShopper(h, kind === "report" ? "j10" : "j11");
  if (kind === "report") {
    const report = (
      await h.q(
        `insert into public.content_reports (reporter_id, target_type, target_id, reason, details)
         select $1, 'product', p.id, 'misleading', 'La foto no es la del producto, carrera.'
           from public.products p order by p.id limit 1 returning id`,
        [who.user],
      )
    ).rows[0].id;
    const kase = (await h.q("select id from private.cases where report_id = $1", [report])).rows[0]
      .id;
    return { ...who, kase };
  }
  await h.q(
    `insert into public.complaints (user_id, category, description, status, resolution, resolved_at)
     values ($1, 'other', 'Queja vieja de la carrera once.', 'resolved', 'Ya le respondimos.', now())`,
    [who.user],
  );
  const kase = (
    await h.call(STAFF, "select public.ops_record_contact('phone', 'other', $1, null, $2) as id", [
      "Pregunta de la carrera once por teléfono.",
      who.user,
    ])
  ).id;
  return { ...who, kase };
}
const deleting = (ctx) => ({
  name: "delete",
  as: ctx.email,
  sql: "select public.delete_my_account()",
  args: [],
});
const j9 = (_h, ctx) => [
  deleting(ctx),
  { name: "reopen", as: STAFF, sql: "select public.ops_reopen_case($1)", args: [ctx.kase] },
];
async function verifyJ9(h, ctx, results) {
  const bad = refusals(results, {
    delete: ["account_has_open_complaints"],
    reopen: ["case_account_deleted"],
  });
  const del = results.find((r) => r.name === "delete");
  const reopen = results.find((r) => r.name === "reopen");
  const s = (
    await h.q(
      `select k.status as case_status, x.status as complaint_status,
              (select deleted_at is not null from auth.users where id = $2) as deleted
         from private.cases k join public.complaints x on x.id = k.complaint_id where k.id = $1`,
      [ctx.kase, ctx.user],
    )
  ).rows[0];
  if (!del.outcome && !reopen.outcome) bad.push("both the deletion and the reopening went through");
  if (s.deleted && (await sourceTextsKept(h, ctx.user)) !== 0)
    bad.push("the complaint's answer kept after the deletion");
  if (s.deleted && (s.case_status !== "closed" || s.complaint_status !== "resolved"))
    bad.push(`a deleted account with its case ${s.case_status}, complaint ${s.complaint_status}`);
  if ((s.case_status === "closed") !== (s.complaint_status === "resolved"))
    bad.push(`case ${s.case_status} but complaint ${s.complaint_status}`);
  return bad;
}
const j10 = (_h, ctx) => [
  deleting(ctx),
  {
    name: "answer",
    as: STAFF,
    sql: "select public.ops_answer_case($1, $2, false)",
    args: [ctx.kase, ANSWER_A],
  },
];
const j11 = (_h, ctx) => [
  deleting(ctx),
  { name: "assign", as: STAFF, sql: "select public.ops_assign_case($1)", args: [ctx.kase] },
];
/** After J10 or J11: a deleted account keeps no text, and a contact of it is closed. */
async function verifyDeletedCase(h, ctx, results, allowed) {
  const bad = refusals(results, allowed);
  const del = results.find((r) => r.name === "delete");
  if (del.outcome && !lockLost(del)) bad.push(`deletion refused: ${del.outcome}`);
  const s = (
    await h.q(
      `select k.kind, k.status,
              (select count(*)::int from private.case_entries e where e.case_id = k.id
                 and e.kind in ('note', 'answer') and e.body is distinct from private.erased_case_text()) as kept,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'answer') as answers,
              (select count(*)::int from private.case_entries e where e.case_id = k.id and e.kind = 'assigned') as assigned,
              k.summary is null or k.summary = private.erased_case_text() as summary_gone
         from private.cases k where k.id = $1`,
      [ctx.kase],
    )
  ).rows[0];
  if (!del.outcome) {
    if (s.kept !== 0 || !s.summary_gone) bad.push(`${s.kept} texts kept after the deletion`);
    if (s.kind === "contact" && s.status !== "closed") bad.push(`the contact is ${s.status}`);
    if ((await sourceTextsKept(h, ctx.user)) !== 0) bad.push("a staff text kept on a source row");
  }
  const answer = results.find((r) => r.name === "answer");
  if (answer && s.answers !== (answer.outcome ? 0 : 1))
    bad.push(`${s.answers} answers, answer ${answer.outcome || "ok"}`);
  const assign = results.find((r) => r.name === "assign");
  if (assign && s.assigned !== (assign.outcome ? 0 : 1))
    bad.push(`${s.assigned} assignments, assign ${assign.outcome || "ok"}`);
  return bad;
}
/** The deletion holds the account row and waits at the profile, which this session holds. */
const holdProfile = (_h, ctx) => ({
  hold: { sql: "select 1 from public.profiles where id = $1 for update", args: [ctx.user] },
  holdMs: 150,
});
function deletionTrio(name, setup, actors, verify) {
  return [
    { name: `${name} natural`, setup, actors: natural(actors), verify },
    {
      name: `${name} forced, deletion under way`,
      setup,
      actors: forced(actors, 1),
      options: holdProfile,
      verify,
    },
    {
      name: `${name} forced, staff first`,
      setup,
      actors: forced(actors, 0),
      options: holdCase,
      verify,
    },
  ];
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
  {
    name: "J7 delete_my_account vs ops_record_contact natural",
    setup: setupJ7,
    actors: natural(j7),
    verify: verifyJ7,
  },
  {
    name: "J7 delete_my_account vs ops_record_contact forced, deletion under way",
    setup: setupJ7,
    actors: forced(j7, 1),
    options: holdOldComplaint,
    verify: verifyJ7,
  },
  {
    name: "J7 delete_my_account vs ops_record_contact forced, contact first",
    setup: setupJ7,
    actors: forced(j7, 0),
    options: holdOldComplaint,
    verify: verifyJ7,
  },
  {
    name: "J8a ten contacts of one writer at once, five numbers each",
    setup: setupJ8,
    actors: j8(false),
    verify: (h, ctx, results) => verifyJ8(h, ctx, results, false),
  },
  {
    name: "J8b ten contacts of one writer at once, each with the code",
    setup: setupJ8,
    actors: j8(true),
    verify: (h, ctx, results) => verifyJ8(h, ctx, results, true),
  },
  ...deletionTrio("J9 delete_my_account vs ops_reopen_case", setupJ9, j9, verifyJ9),
  ...deletionTrio(
    "J10 delete_my_account vs ops_answer_case on an open report",
    (h) => setupJ10(h, "report"),
    j10,
    (h, ctx, results) => verifyDeletedCase(h, ctx, results, { answer: ["case_account_deleted"] }),
  ),
  ...deletionTrio(
    "J11 delete_my_account vs ops_assign_case on an open contact",
    (h) => setupJ10(h, "contact"),
    j11,
    (h, ctx, results) => verifyDeletedCase(h, ctx, results, { assign: ["case_closed"] }),
  ),
];

module.exports = {
  scenarios,
  setupJ5,
  j5,
  verifyJ5,
  setupJ7,
  j7,
  verifyJ7,
  holdOldComplaint,
  complaint,
  j1,
  verifyJ1,
};

if (require.main === module) {
  main("J", scenarios).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
