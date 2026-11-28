import { sessionApi } from "@yuntera/next-kit/server";
import { PageHeader } from "@yuntera/next-kit/shell";
import { EmptyState, formatDateTime, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { DeleteReplyForm, SavedReplyForm } from "@/components/case-forms";
import { CasesNav } from "@/components/cases-nav";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Respuestas guardadas" };

export default function SavedRepliesPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Respuestas guardadas">
        Textos para las preguntas de siempre. Atención al cliente los usa al responder un caso con
        «Usar una respuesta guardada» y los ajusta antes de enviar. Solo un administrador los
        escribe; cada cambio queda en Auditoría.
      </PageHeader>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Replies />
        </Suspense>
      </div>
    </div>
  );
}

async function Replies() {
  const staff = await requireStaff("/casos/respuestas", ["support"]);
  const admin = staff.staff_role === "admin";
  const replies = await (await sessionApi()).opsSavedReplies();
  return (
    <>
      <CasesNav current="/casos/respuestas" support />
      {replies.length === 0 ? <EmptyState title="No hay respuestas guardadas" /> : null}
      <ul className="grid gap-4 lg:grid-cols-2" data-testid="saved-replies">
        {replies.map((reply) => (
          <li key={reply.id} className="rounded-lg border border-border bg-surface p-5 text-sm">
            {admin ? (
              <>
                <SavedReplyForm reply={reply} />
                <div className="mt-3 border-t border-border pt-3">
                  <DeleteReplyForm replyId={reply.id} />
                </div>
              </>
            ) : (
              <>
                <p className="font-semibold wrap-anywhere">{reply.title}</p>
                <p className="mt-2 whitespace-pre-line wrap-anywhere">{reply.body}</p>
              </>
            )}
            <p className="mt-2 text-xs text-ink-muted">
              Último cambio: {formatDateTime(reply.updated_at)}
            </p>
          </li>
        ))}
      </ul>
      {admin ? (
        <section aria-labelledby="nueva" className="mt-8 max-w-xl">
          <h2 id="nueva" className="text-xl font-bold">
            Nueva respuesta guardada
          </h2>
          <div className="mt-3 rounded-lg border border-border bg-surface p-5">
            <SavedReplyForm />
          </div>
        </section>
      ) : null}
    </>
  );
}
