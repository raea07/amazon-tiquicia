"use client";

import type { SavedReply } from "@yuntera/db";
import { ActionForm, type ActionState, FormMessage, SubmitButton } from "@yuntera/next-kit/client";
import { SelectField, TextAreaField, TextField } from "@yuntera/ui";
import { useActionState, useEffect, useState } from "react";
import {
  addCaseNote,
  answerCase,
  assignCase,
  deleteReply,
  recordContact,
  reopenCase,
  revealContact,
  saveReply,
} from "@/app/case-actions";
import { CONTACT_TOPIC } from "@/lib/case-labels";

const initial: ActionState = {};

/** An internal note. The screen says the customer never sees it. */
export function CaseNoteForm({ caseId }: { caseId: string }) {
  return (
    <ActionForm action={addCaseNote} submit="Guardar la nota" pendingLabel="Guardando…">
      <input type="hidden" name="caseId" value={caseId} />
      <TextAreaField
        label="Nota interna"
        name="note"
        rows={3}
        maxLength={2000}
        hint="Solo la ve el equipo: el cliente nunca ve esta nota. No escriba el código de entrega."
      />
    </ActionForm>
  );
}

/**
 * The answer the customer reads in their account and on the order's page.
 * "Usar una respuesta guardada" puts a saved answer's text in the field, to
 * adjust before sending.
 */
export function CaseAnswerForm({
  caseId,
  replies,
  canClose,
}: {
  caseId: string;
  replies: SavedReply[];
  /** False while a return or a report still waits for its decision in Atención. */
  canClose: boolean;
}) {
  const [state, action] = useActionState(answerCase, initial);
  const [text, setText] = useState(state.values?.answer ?? "");
  const [chosen, setChosen] = useState("");
  // Sent: the field empties for the next answer.
  useEffect(() => {
    if (state.ok) {
      setText("");
      setChosen("");
    }
  }, [state]);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="caseId" value={caseId} />
      {replies.length > 0 ? (
        <SelectField
          label="Usar una respuesta guardada"
          value={chosen}
          optional
          hint="Copia el texto en la respuesta; puede cambiarlo antes de enviar."
          onChange={(event) => {
            setChosen(event.target.value);
            const found = replies.find((reply) => reply.id === event.target.value);
            if (found) setText(found.body);
          }}
        >
          <option value="">Elija una respuesta</option>
          {replies.map((reply) => (
            <option key={reply.id} value={reply.id}>
              {reply.title}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextAreaField
        label="Respuesta al cliente"
        name="answer"
        rows={5}
        maxLength={4000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        hint="El cliente la lee en su cuenta y en la página del pedido. No escriba el código de entrega."
      />
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="close" value="no" pendingLabel="Enviando…">
          Responder
        </SubmitButton>
        {canClose ? (
          <SubmitButton name="close" value="yes" variant="secondary" pendingLabel="Enviando…">
            Responder y cerrar
          </SubmitButton>
        ) : null}
      </div>
      {canClose ? null : (
        <p className="text-sm text-ink-muted">
          Este caso se cierra solo cuando se decida en Atención.
        </p>
      )}
    </form>
  );
}

export function AssignCaseForm({ caseId }: { caseId: string }) {
  return (
    <ActionForm action={assignCase} submit="Asignarme el caso" variant="secondary" hideOnSuccess>
      <input type="hidden" name="caseId" value={caseId} />
    </ActionForm>
  );
}

export function ReopenCaseForm({ caseId }: { caseId: string }) {
  return (
    <ActionForm action={reopenCase} submit="Volver a abrir el caso" variant="secondary">
      <input type="hidden" name="caseId" value={caseId} />
    </ActionForm>
  );
}

/** "Registrar un contacto" against an order (its number) or a customer (their id). */
export function RecordContactForm({
  orderNumber,
  userId,
}: {
  orderNumber?: string;
  userId?: string;
}) {
  return (
    <ActionForm action={recordContact} submit="Registrar el contacto" pendingLabel="Guardando…">
      {orderNumber ? <input type="hidden" name="orderNumber" value={orderNumber} /> : null}
      {userId ? <input type="hidden" name="userId" value={userId} /> : null}
      <SelectField label="Por dónde llegó" name="channel" defaultValue="">
        <option value="" disabled>
          Elija una opción
        </option>
        <option value="whatsapp">WhatsApp</option>
        <option value="phone">Teléfono</option>
        <option value="email">Correo</option>
      </SelectField>
      <SelectField label="De qué trató" name="topic" defaultValue="">
        <option value="" disabled>
          Elija una opción
        </option>
        {Object.entries(CONTACT_TOPIC).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        label="Resumen"
        name="summary"
        rows={3}
        maxLength={1000}
        hint="Qué pidió la persona y qué se le dijo, en una o dos líneas. Sin el código de entrega."
      />
    </ActionForm>
  );
}

/** "Mostrar contacto": asks why, and the reason goes on the audit trail. */
export function RevealContactForm({ userId }: { userId: string }) {
  return (
    <ActionForm action={revealContact} submit="Mostrar contacto" variant="secondary">
      <input type="hidden" name="userId" value={userId} />
      <TextField
        label="Para qué lo necesita"
        name="reason"
        maxLength={300}
        hint="Queda registrado en Auditoría con su nombre. Por ejemplo: llamar por la entrega de hoy."
      />
    </ActionForm>
  );
}

/** A saved answer: a new one, or `reply` to change. Administrators only. */
export function SavedReplyForm({ reply }: { reply?: SavedReply }) {
  return (
    <ActionForm
      action={saveReply}
      submit={reply ? "Guardar los cambios" : "Crear la respuesta"}
      pendingLabel="Guardando…"
    >
      {reply ? <input type="hidden" name="replyId" value={reply.id} /> : null}
      <TextField label="Título" name="title" maxLength={80} defaultValue={reply?.title} />
      <TextAreaField
        label="Texto"
        name="body"
        rows={4}
        maxLength={4000}
        defaultValue={reply?.body}
        hint="En usted, claro y concreto: qué pasó, qué hacemos y para cuándo."
      />
    </ActionForm>
  );
}

export function DeleteReplyForm({ replyId }: { replyId: string }) {
  return (
    <ActionForm action={deleteReply} submit="Eliminar" variant="ghost" hideOnSuccess>
      <input type="hidden" name="replyId" value={replyId} />
    </ActionForm>
  );
}
