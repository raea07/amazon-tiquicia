"use server";

/**
 * The support desk's actions: notes, answers, assignment, reopening,
 * recorded contacts, the audited reveal of a customer's contact and of an
 * order's delivery phone, and saved answers. Each re-reads the session, validates its input with zod and calls
 * one database function, which checks the caller's role again; nothing here
 * decides who may do what. A case is addressed by its own id only.
 */

import { parsePhone } from "@yuntera/core";
import { CONTACT_TOPICS, ORDER_CONTACT_REASON } from "@yuntera/db";
import {
  type ActionState,
  attempt,
  GENERIC_ERROR,
  redirectTo,
  sessionApi,
  signInPath,
  typed,
} from "@yuntera/next-kit/server";
import { refresh } from "next/cache";
import { z } from "zod";
import { refusedForCode } from "@/lib/refused-for-code";
import { currentStaff } from "@/lib/staff";

type Api = Awaited<ReturnType<typeof sessionApi>>;

/** Runs a staff action and redraws the page behind the form when it worked. */
async function caseAction(
  returnTo: string,
  run: (api: Api) => Promise<string>,
  values?: Record<string, string>,
): Promise<ActionState> {
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  const state = await attempt(async () => run(await sessionApi()), values);
  if (state.ok) refresh();
  return state;
}

const caseId = z.uuid();

const casePath = (id: string) => `/casos/${id}`;

export async function addCaseNote(_previous: ActionState, formData: FormData) {
  const values = typed(formData, "note");
  const id = caseId.safeParse(formData.get("caseId"));
  if (!id.success) return { error: GENERIC_ERROR };
  const body = z.string().trim().min(1).max(2000).safeParse(values.note);
  if (!body.success) return { error: "Escriba la nota: de 1 a 2000 caracteres.", values };
  return caseAction(
    casePath(id.data),
    async (api) => {
      refusedForCode(await api.opsAddCaseNote(id.data, body.data));
      return "Nota guardada. El cliente no la ve.";
    },
    values,
  );
}

export async function answerCase(_previous: ActionState, formData: FormData) {
  const values = typed(formData, "answer");
  const id = caseId.safeParse(formData.get("caseId"));
  if (!id.success) return { error: GENERIC_ERROR };
  const body = z.string().trim().min(10).max(4000).safeParse(values.answer);
  if (!body.success) {
    return { error: "Escriba la respuesta al cliente: de 10 a 4000 caracteres.", values };
  }
  const close = formData.get("close") === "yes";
  return caseAction(
    casePath(id.data),
    async (api) => {
      refusedForCode(await api.opsAnswerCase(id.data, body.data, close));
      return close
        ? "Respuesta enviada y caso cerrado. El cliente la lee en su cuenta."
        : "Respuesta enviada. El cliente la lee en su cuenta; el caso sigue abierto.";
    },
    values,
  );
}

export async function assignCase(_previous: ActionState, formData: FormData) {
  const id = caseId.safeParse(formData.get("caseId"));
  if (!id.success) return { error: GENERIC_ERROR };
  return caseAction(casePath(id.data), async (api) => {
    await api.opsAssignCase(id.data);
    return "El caso es suyo.";
  });
}

export async function reopenCase(_previous: ActionState, formData: FormData) {
  const id = caseId.safeParse(formData.get("caseId"));
  if (!id.success) return { error: GENERIC_ERROR };
  return caseAction(casePath(id.data), async (api) => {
    await api.opsReopenCase(id.data);
    return "Caso abierto de nuevo. Cuenta como reabierto en el informe.";
  });
}

const contact = z.object({
  channel: z.enum(["whatsapp", "phone", "email"]),
  topic: z.enum(CONTACT_TOPICS),
  summary: z.string().trim().min(10).max(1000),
  orderNumber: z
    .string()
    .trim()
    .regex(/^YT-\d{4,12}$/)
    .or(z.literal("")),
  userId: z.uuid().or(z.literal("")),
});

/** "Registrar un contacto": from an order's page (its number) or a customer's (their id). */
export async function recordContact(_previous: ActionState, formData: FormData) {
  const values = typed(formData, "channel", "topic", "summary", "orderNumber", "userId");
  const parsed = contact.safeParse({
    ...values,
    orderNumber: values.orderNumber ?? "",
    userId: values.userId ?? "",
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "channel") return { error: "Elija por dónde llegó el contacto.", values };
    if (field === "topic") return { error: "Elija de qué trató.", values };
    if (field === "summary") {
      return { error: "Escriba un resumen de 10 a 1000 caracteres.", values };
    }
    return { error: GENERIC_ERROR, values };
  }
  const { orderNumber, userId } = parsed.data;
  if (!orderNumber && !userId) return { error: GENERIC_ERROR, values };
  const returnTo = orderNumber ? `/pedidos/${orderNumber}` : `/clientes/${userId}`;
  return caseAction(
    returnTo,
    async (api) => {
      refusedForCode(
        await api.opsRecordContact({
          channel: parsed.data.channel,
          topic: parsed.data.topic,
          summary: parsed.data.summary,
          orderNumber: orderNumber || null,
          userId: orderNumber ? null : userId || null,
        }),
      );
      return "Contacto registrado como caso. Lo encuentra en Casos.";
    },
    values,
  );
}

const orderNumber = z.string().regex(/^YT-\d{4,12}$/);

/**
 * "Mostrar contacto": the reason is written on the audit trail. A customer's
 * contact (`userId`, the customer view) or an order's delivery phone
 * (`orderNumber`, the order page; owner decision D55).
 */
export async function revealContact(_previous: ActionState, formData: FormData) {
  const values = typed(formData, "reason");
  const order = formData.has("orderNumber")
    ? orderNumber.safeParse(formData.get("orderNumber"))
    : null;
  const userId = order ? null : z.uuid().safeParse(formData.get("userId"));
  if ((order && !order.success) || (userId && !userId.success)) return { error: GENERIC_ERROR };
  const reason = z
    .string()
    .trim()
    .min(ORDER_CONTACT_REASON.min)
    .max(ORDER_CONTACT_REASON.max)
    .safeParse(values.reason);
  if (!reason.success) {
    return { error: "Escriba para qué necesita el contacto: de 10 a 300 caracteres.", values };
  }
  const returnTo = order?.data ? `/pedidos/${order.data}` : `/clientes/${userId?.data}`;
  if (!(await currentStaff())) redirectTo(signInPath(returnTo));
  // No refresh: the contact is shown once, in this answer, and never stored on the page.
  return attempt(async () => {
    const api = await sessionApi();
    if (order?.data) {
      const found = await api.opsOrderContact(order.data, reason.data);
      const phone = found.phone ? (parsePhone(found.phone)?.formatted ?? found.phone) : null;
      return `Teléfono de entrega: ${phone ?? "no tiene"}. Quedó registrado en Auditoría que usted lo vio.`;
    }
    const found = await api.opsCustomerContact(userId?.data ?? "", reason.data);
    return `Correo: ${found.email ?? "no tiene"} · Teléfono: ${found.phone ?? "no tiene"}. Quedó registrado en Auditoría que usted lo vio.`;
  }, values);
}

const reply = z.object({
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().min(10).max(4000),
});

export async function saveReply(_previous: ActionState, formData: FormData) {
  const values = typed(formData, "title", "body");
  const replyId = formData.get("replyId");
  const id = replyId ? z.uuid().safeParse(replyId) : null;
  if (id && !id.success) return { error: GENERIC_ERROR };
  const parsed = reply.safeParse(values);
  if (!parsed.success) {
    return {
      error: "La respuesta necesita un título de 3 a 80 caracteres y un texto de 10 a 4000.",
      values,
    };
  }
  return caseAction(
    "/casos/respuestas",
    async (api) => {
      await api.opsSaveReply(parsed.data.title, parsed.data.body, id?.data ?? null);
      return id ? "Respuesta guardada actualizada." : "Respuesta guardada creada.";
    },
    values,
  );
}

export async function deleteReply(_previous: ActionState, formData: FormData) {
  const id = z.uuid().safeParse(formData.get("replyId"));
  if (!id.success) return { error: GENERIC_ERROR };
  return caseAction("/casos/respuestas", async (api) => {
    await api.opsDeleteReply(id.data);
    return "Respuesta guardada eliminada.";
  });
}
