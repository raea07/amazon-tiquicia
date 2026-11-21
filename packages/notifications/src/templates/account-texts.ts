/**
 * The words of every account e-mail, shared by the two ways they can be sent:
 *
 *   - Supabase Auth's own mailer, with the templates in supabase/templates
 *     (applied to the project by supabase/scripts/auth-config.sh). Used until
 *     the messaging provider is set up.
 *   - The Send Email Hook (supabase/functions/auth-email, `authEmails` in
 *     ./auth.ts), which sends them through the provider once it is.
 *
 * Keyed by the Auth template name. `{email}`, `{new_email}` and `{old_email}`
 * stand where the templates have `{{ .Email }}`, `{{ .NewEmail }}` and
 * `{{ .OldEmail }}`; `{token}` where they have `{{ .Token }}`.
 * account-texts.test.ts checks that every sentence here is in the template of
 * the same name, word for word, and that both build the same link: the app's
 * /auth/confirm with `token_hash` and `type`, and the same 6-digit code.
 */

export interface AccountEmailText {
  subject: string;
  heading: string;
  intro: string;
  /** The button, for e-mails that confirm something with a link and a code. */
  button?: string;
  /** The `type` the link carries to /auth/confirm. */
  linkType?: "email" | "recovery" | "email_change" | "magiclink" | "invite";
  /** The sentence before the code, for e-mails that carry one. */
  codeLine?: string;
  /** Small print after the code. */
  expiry?: string;
  /** The last sentence: what to do if the person did not ask for this. */
  note: string;
}

const CODE_LINE = "Si está usando la aplicación, o el botón no abre, escriba este código:";
const EXPIRY = "El enlace y el código sirven una sola vez y vencen en una hora.";

export const ACCOUNT_EMAILS = {
  confirmation: {
    subject: "Confirme su correo en Yuntera",
    heading: "Confirme su correo",
    intro:
      "Para terminar de crear su cuenta en Yuntera con la dirección {email}, confirme que este correo es suyo.",
    button: "Confirmar mi correo",
    linkType: "email",
    codeLine: CODE_LINE,
    expiry: EXPIRY,
    note: "Si usted no creó esta cuenta, no haga nada: sin la confirmación no se activa.",
  },
  recovery: {
    subject: "Restablezca su contraseña de Yuntera",
    heading: "Restablezca su contraseña",
    intro:
      "Recibimos una solicitud para cambiar la contraseña de la cuenta {email}. Abra el enlace para elegir una nueva.",
    button: "Elegir una contraseña nueva",
    linkType: "recovery",
    codeLine: CODE_LINE,
    expiry: EXPIRY,
    note: "Si usted no lo pidió, ignore este correo: su contraseña actual sigue funcionando.",
  },
  email_change: {
    subject: "Confirme su nuevo correo en Yuntera",
    heading: "Confirme su nuevo correo",
    intro:
      "Pidió usar {new_email} en lugar de {email} para ingresar a Yuntera. Confirme el cambio desde la dirección nueva.",
    button: "Confirmar el cambio",
    linkType: "email_change",
    codeLine: CODE_LINE,
    expiry: EXPIRY,
    note: "Si usted no pidió este cambio, ignore este correo y cambie su contraseña.",
  },
  magic_link: {
    subject: "Su enlace para ingresar a Yuntera",
    heading: "Ingrese a Yuntera",
    intro: "Use este enlace para ingresar a la cuenta {email} sin escribir la contraseña.",
    button: "Ingresar",
    linkType: "magiclink",
    codeLine: CODE_LINE,
    expiry: EXPIRY,
    note: "Si usted no lo pidió, ignore este correo: nadie puede ingresar sin abrirlo.",
  },
  invite: {
    subject: "Le invitaron a Yuntera",
    heading: "Le invitaron a Yuntera",
    intro:
      "Le crearon una cuenta en Yuntera con la dirección {email}. Abra el enlace para activarla y elegir su contraseña.",
    button: "Activar mi cuenta",
    linkType: "invite",
    codeLine: CODE_LINE,
    expiry: EXPIRY,
    note: "Si no esperaba esta invitación, ignore este correo.",
  },
  reauthentication: {
    subject: "{token} es su código de verificación de Yuntera",
    heading: "Su código de verificación",
    intro: "Para confirmar un cambio importante en su cuenta, escriba este código en Yuntera:",
    note: "Sirve una sola vez. Si usted no lo pidió, cambie su contraseña ahora.",
  },
  password_changed_notification: {
    subject: "Su contraseña de Yuntera cambió",
    heading: "Su contraseña cambió",
    intro:
      "La contraseña de la cuenta {email} se cambió y se cerraron las demás sesiones abiertas.",
    note: "Si no fue usted, cambie su contraseña ahora desde «Olvidé mi contraseña» y escríbanos.",
  },
  email_changed_notification: {
    subject: "El correo de su cuenta de Yuntera cambió",
    heading: "El correo de su cuenta cambió",
    intro: "Su cuenta de Yuntera dejó de usar {old_email} y ahora usa {email}.",
    note: "Si no fue usted, escríbanos de inmediato desde esta dirección.",
  },
  mfa_factor_enrolled_notification: {
    subject: "Activó la verificación en dos pasos en Yuntera",
    heading: "Verificación en dos pasos activada",
    intro:
      "Se agregó una aplicación de autenticación a la cuenta {email}. A partir de ahora le pediremos su código al ingresar.",
    note: "Si no fue usted, escríbanos de inmediato: alguien más podría tener su contraseña.",
  },
  mfa_factor_unenrolled_notification: {
    subject: "Se quitó la verificación en dos pasos en Yuntera",
    heading: "Verificación en dos pasos quitada",
    intro: "Se quitó una aplicación de autenticación de la cuenta {email}.",
    note: "Si no fue usted, escríbanos de inmediato.",
  },
} as const satisfies Record<string, AccountEmailText>;

export type AccountEmailName = keyof typeof ACCOUNT_EMAILS;

/** Which Auth template each `email_action_type` of the Send Email Hook uses. */
export const TEMPLATE_FOR_ACTION: Record<string, AccountEmailName> = {
  signup: "confirmation",
  recovery: "recovery",
  email_change: "email_change",
  magiclink: "magic_link",
  invite: "invite",
  reauthentication: "reauthentication",
  password_changed_notification: "password_changed_notification",
  email_changed_notification: "email_changed_notification",
  mfa_factor_enrolled_notification: "mfa_factor_enrolled_notification",
  mfa_factor_unenrolled_notification: "mfa_factor_unenrolled_notification",
};

/** A text with its placeholders filled. */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(
    /\{(email|new_email|old_email|token)\}/g,
    (_, key: string) => values[key] ?? "",
  );
}
