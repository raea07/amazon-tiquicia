"use client";

import { ActionForm } from "@yuntera/next-kit/client";
import { SelectField, TextField } from "@yuntera/ui";
import {
  answerInvitation,
  inviteMember,
  removeMember,
  revokeInvitation,
  setMemberRole,
} from "@/app/team-actions";

/** Invites someone by the e-mail they sign in with. Only the owner may offer "administrador". */
export function InviteForm({ canInviteAdmins }: { canInviteAdmins: boolean }) {
  return (
    <ActionForm action={inviteMember} submit="Enviar invitación" pendingLabel="Enviando…">
      {(state) => (
        <>
          <TextField
            label="Correo de la persona"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
            defaultValue={state.values?.email}
            hint="El correo con que ingresa a Yuntera. Si todavía no tiene cuenta, que la cree primero."
          />
          <SelectField
            label="Qué podrá hacer"
            name="role"
            defaultValue={state.values?.role ?? "staff"}
            hint={
              canInviteAdmins
                ? "Personal publica, edita y despacha. Administración, además, maneja el equipo y la cuenta."
                : "Personal publica, edita y despacha."
            }
          >
            <option value="staff">Personal</option>
            {canInviteAdmins ? <option value="admin">Administración</option> : null}
          </SelectField>
        </>
      )}
    </ActionForm>
  );
}

export function RevokeInvitationForm({ invitationId }: { invitationId: string }) {
  return (
    <ActionForm
      action={revokeInvitation}
      submit="Retirar invitación"
      pendingLabel="Retirando…"
      variant="secondary"
      size="sm"
      hideOnSuccess
    >
      <input type="hidden" name="invitationId" value={invitationId} />
    </ActionForm>
  );
}

export function MemberRoleForm({
  userId,
  role,
  name,
}: {
  userId: string;
  role: "admin" | "staff";
  name: string;
}) {
  return (
    <ActionForm
      action={setMemberRole}
      submit="Cambiar rol"
      pendingLabel="Guardando…"
      variant="secondary"
      size="sm"
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="userId" value={userId} />
      <SelectField label={`Rol de ${name}`} name="role" defaultValue={role} className="min-w-48">
        <option value="staff">Personal</option>
        <option value="admin">Administración</option>
      </SelectField>
    </ActionForm>
  );
}

export function RemoveMemberForm({ userId, leaving }: { userId: string; leaving: boolean }) {
  return (
    <ActionForm
      action={removeMember}
      submit={leaving ? "Salir del equipo" : "Quitar del equipo"}
      pendingLabel="Un momento…"
      variant="secondary"
      size="sm"
      hideOnSuccess
    >
      <input type="hidden" name="userId" value={userId} />
      {leaving ? <input type="hidden" name="leaving" value="1" /> : null}
    </ActionForm>
  );
}

/** Accept or decline: one small form for each answer. */
export function AnswerInvitationForm({ invitationId }: { invitationId: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <ActionForm action={answerInvitation} submit="Aceptar y unirme" pendingLabel="Uniéndome…">
        <input type="hidden" name="invitationId" value={invitationId} />
        <input type="hidden" name="answer" value="accept" />
      </ActionForm>
      <ActionForm
        action={answerInvitation}
        submit="Rechazar"
        pendingLabel="Un momento…"
        variant="secondary"
        hideOnSuccess
      >
        <input type="hidden" name="invitationId" value={invitationId} />
        <input type="hidden" name="answer" value="decline" />
      </ActionForm>
    </div>
  );
}
