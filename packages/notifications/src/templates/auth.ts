/**
 * Account e-mails sent for Supabase Auth through its Send Email Hook
 * (section 3.3 of the research note): confirmation, password reset, e-mail
 * change, re-authentication and security notices. Rendered with the same
 * layout as every other e-mail and sent through the same adapter.
 */

import { clean } from "../format.ts";
import type { RenderedEmail } from "../types.ts";
import type { Copy } from "./catalog.ts";
import { renderEmail, type Sender } from "./render.ts";

export interface SendEmailHookPayload {
  user: {
    id: string;
    email: string;
    new_email?: string;
    user_metadata?: Record<string, unknown>;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

export interface AuthEmail {
  to: string;
  template: string;
  rendered: RenderedEmail;
}

const NOTICES: Record<string, string> = {
  password_changed_notification: "Se cambió la contraseña de su cuenta",
  email_changed_notification: "Se cambió el correo de su cuenta",
  phone_changed_notification: "Se cambió el teléfono de su cuenta",
  identity_linked_notification: "Se conectó un nuevo método de ingreso a su cuenta",
  identity_unlinked_notification: "Se desconectó un método de ingreso de su cuenta",
  mfa_factor_enrolled_notification: "Se agregó un segundo factor de verificación a su cuenta",
  mfa_factor_unenrolled_notification: "Se quitó un segundo factor de verificación de su cuenta",
};

/** The link that confirms a token hash, on the app the person came from. */
export function confirmLink(
  redirectTo: string,
  siteUrl: string,
  hash: string,
  type: string,
): string {
  const base = /^https?:\/\//.test(redirectTo)
    ? redirectTo
    : `${siteUrl.replace(/\/$/, "")}/auth/confirm`;
  const url = new URL(base);
  url.searchParams.set("token_hash", hash);
  url.searchParams.set("type", type);
  return url.toString();
}

const SECURITY_NOTE =
  "Si usted no lo pidió, ignore este correo: su cuenta sigue igual. Nadie de Yuntera le va a pedir este código.";

function codeCopy(
  subject: string,
  lead: string,
  code: string,
  link?: { label: string; url: string },
): Copy {
  return {
    from: "account",
    subject,
    preheader: lead,
    greeting: "Hola:",
    paragraphs: [
      lead,
      link
        ? "Toque el botón o, si está en la aplicación, escriba este código:"
        : "Escriba este código:",
      clean(code, 12),
      "El código y el enlace vencen en una hora.",
    ],
    ...(link ? { action: link } : {}),
    note: SECURITY_NOTE,
  };
}

/**
 * The e-mails one hook call must send. Unknown action types get a plain
 * notice rather than an error, so a new Auth release cannot break sign-in.
 */
export function authEmails(payload: SendEmailHookPayload, sender: Sender): AuthEmail[] {
  const { user, email_data: d } = payload;
  const link = (hash: string, type: string) => confirmLink(d.redirect_to, d.site_url, hash, type);
  const one = (to: string, template: string, copy: Copy): AuthEmail => ({
    to,
    template,
    rendered: renderEmail(copy, sender),
  });

  switch (d.email_action_type) {
    case "signup":
      return [
        one(
          user.email,
          "auth_confirm_signup",
          codeCopy(
            "Confirme su correo para usar Yuntera",
            "Confirme que este correo es suyo para terminar de crear su cuenta.",
            d.token,
            {
              label: "Confirmar mi correo",
              url: link(d.token_hash, "email"),
            },
          ),
        ),
      ];
    case "recovery":
      return [
        one(
          user.email,
          "auth_recovery",
          codeCopy(
            "Cambie su contraseña de Yuntera",
            "Recibimos un pedido para cambiar la contraseña de su cuenta.",
            d.token,
            {
              label: "Elegir una contraseña nueva",
              url: link(d.token_hash, "recovery"),
            },
          ),
        ),
      ];
    case "magiclink":
    case "invite":
      return [
        one(
          user.email,
          "auth_sign_in_link",
          codeCopy(
            "Su enlace para ingresar a Yuntera",
            "Use este enlace para ingresar a su cuenta.",
            d.token,
            {
              label: "Ingresar",
              url: link(d.token_hash, d.email_action_type === "invite" ? "invite" : "email"),
            },
          ),
        ),
      ];
    case "email_change": {
      const newEmail = clean(user.new_email ?? "", 200);
      // With secure e-mail change both addresses confirm, and the hash names are
      // crossed: the current address gets `token` with `token_hash_new`, the new
      // address gets `token_new` with `token_hash` (research note, section 3.3).
      if (d.token_hash_new) {
        return [
          one(
            user.email,
            "auth_email_change_current",
            codeCopy(
              "Confirme el cambio de correo",
              `Pidió cambiar el correo de su cuenta a ${newEmail}.`,
              d.token,
              {
                label: "Confirmar el cambio",
                url: link(d.token_hash_new, "email_change"),
              },
            ),
          ),
          one(
            user.new_email ?? user.email,
            "auth_email_change_new",
            codeCopy(
              "Confirme su correo nuevo",
              "Confirme que este correo es suyo para usarlo en su cuenta de Yuntera.",
              d.token_new ?? "",
              {
                label: "Confirmar mi correo",
                url: link(d.token_hash, "email_change"),
              },
            ),
          ),
        ];
      }
      return [
        one(
          user.new_email ?? user.email,
          "auth_email_change_new",
          codeCopy(
            "Confirme su correo nuevo",
            "Confirme que este correo es suyo para usarlo en su cuenta de Yuntera.",
            d.token,
            {
              label: "Confirmar mi correo",
              url: link(d.token_hash, "email_change"),
            },
          ),
        ),
      ];
    }
    case "reauthentication":
      return [
        one(
          user.email,
          "auth_reauthentication",
          codeCopy(
            "Su código de verificación de Yuntera",
            "Para continuar, confirme que es usted.",
            d.token,
          ),
        ),
      ];
    default: {
      const label = NOTICES[d.email_action_type] ?? "Hubo un cambio de seguridad en su cuenta";
      return [
        one(user.email, "auth_security_notice", {
          from: "account",
          subject: label,
          preheader: label,
          greeting: "Hola:",
          paragraphs: [
            `${label}.`,
            "Si fue usted, no tiene que hacer nada. Si no lo reconoce, cambie su contraseña y escríbanos respondiendo a este correo.",
          ],
          action: { label: "Ir a su cuenta", url: `${d.site_url.replace(/\/$/, "")}/cuenta` },
        }),
      ];
    }
  }
}
