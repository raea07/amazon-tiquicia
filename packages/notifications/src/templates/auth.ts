/**
 * Account e-mails sent for Supabase Auth through its Send Email Hook
 * (section 3.3 of the research note): confirmation, password reset, e-mail
 * change, re-authentication and security notices. Rendered with the same
 * layout as every other e-mail and sent through the same adapter, in the same
 * words as Auth's own templates (./account-texts.ts).
 */

import { clean } from "../format.ts";
import type { RenderedEmail } from "../types.ts";
import {
  ACCOUNT_EMAILS,
  type AccountEmailName,
  type AccountEmailText,
  fill,
  TEMPLATE_FOR_ACTION,
} from "./account-texts.ts";
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
    /** The previous address, on the e-mail-changed notice. */
    old_email?: string;
  };
}

export interface AuthEmail {
  to: string;
  template: string;
  rendered: RenderedEmail;
}

// Security notices Auth may send that have no template of ours yet.
const OTHER_NOTICES: Record<string, string> = {
  phone_changed_notification: "Se cambió el teléfono de su cuenta",
  identity_linked_notification: "Se conectó un nuevo método de ingreso a su cuenta",
  identity_unlinked_notification: "Se desconectó un método de ingreso de su cuenta",
};

/**
 * The link that confirms a token hash: always the one verifying route,
 * `/auth/confirm` (built by the account-security work in every app, with
 * `confirmUrl()` as the redirect target), on the app the person came from.
 * Only the origin of `redirect_to` is used (Supabase Auth has already checked
 * it against the allow list), so the token never lands on any other page, its
 * analytics or its referrer.
 */
export function confirmLink(
  redirectTo: string,
  siteUrl: string,
  hash: string,
  type: string,
): string {
  let origin: string;
  try {
    const from = new URL(redirectTo);
    origin = /^https?:$/.test(from.protocol) ? from.origin : new URL(siteUrl).origin;
  } catch {
    origin = new URL(siteUrl).origin;
  }
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", hash);
  url.searchParams.set("type", type);
  return url.toString();
}

/**
 * One account e-mail in the shared words (./account-texts.ts): the same
 * heading, sentences, button, code and small print as the template of the
 * same name that Supabase Auth's own mailer uses.
 */
function accountCopy(
  name: AccountEmailName,
  values: Record<string, string>,
  code?: string,
  url?: string,
): Copy {
  const t: AccountEmailText = ACCOUNT_EMAILS[name];
  const paragraphs = [fill(t.intro, values)];
  if (code !== undefined) {
    if (t.codeLine) paragraphs.push(t.codeLine);
    paragraphs.push(clean(code, 12));
    if (t.expiry) paragraphs.push(t.expiry);
  }
  return {
    from: "account",
    subject: fill(t.subject, { ...values, token: clean(code ?? "", 12) }),
    preheader: t.heading,
    greeting: t.heading,
    paragraphs,
    ...(t.button && url ? { action: { label: t.button, url } } : {}),
    note: t.note,
  };
}

/**
 * The e-mails one hook call must send. Unknown action types get a plain
 * notice rather than an error, so a new Auth release cannot break sign-in.
 */
export function authEmails(payload: SendEmailHookPayload, sender: Sender): AuthEmail[] {
  const { user, email_data: d } = payload;
  const values = {
    email: clean(user.email, 200),
    new_email: clean(user.new_email ?? "", 200),
    old_email: clean(d.old_email ?? "", 200),
  };
  const one = (to: string, template: string, copy: Copy): AuthEmail => ({
    to,
    template,
    rendered: renderEmail(copy, sender),
  });
  const name = TEMPLATE_FOR_ACTION[d.email_action_type];
  if (!name) {
    const label = OTHER_NOTICES[d.email_action_type] ?? "Hubo un cambio de seguridad en su cuenta";
    return [
      one(user.email, "auth_security_notice", {
        from: "account",
        subject: label,
        preheader: label,
        greeting: label,
        paragraphs: [
          "Si fue usted, no tiene que hacer nada. Si no lo reconoce, cambie su contraseña y escríbanos respondiendo a este correo.",
        ],
      }),
    ];
  }
  const t: AccountEmailText = ACCOUNT_EMAILS[name];
  const link = (hash: string) =>
    t.linkType ? confirmLink(d.redirect_to, d.site_url, hash, t.linkType) : undefined;
  const template = `auth_${name}`;

  if (name === "email_change") {
    // With secure e-mail change both addresses confirm, and the hash names are
    // crossed: the current address gets `token` with `token_hash_new`, the new
    // address gets `token_new` with `token_hash` (research note, section 3.3).
    // Auth's own mailer sends the same template to both.
    if (d.token_hash_new) {
      return [
        one(user.email, template, accountCopy(name, values, d.token, link(d.token_hash_new))),
        one(
          user.new_email ?? user.email,
          template,
          accountCopy(name, values, d.token_new ?? "", link(d.token_hash)),
        ),
      ];
    }
    return [
      one(
        user.new_email ?? user.email,
        template,
        accountCopy(name, values, d.token, link(d.token_hash)),
      ),
    ];
  }
  if (t.codeLine || name === "reauthentication") {
    return [one(user.email, template, accountCopy(name, values, d.token, link(d.token_hash)))];
  }
  // A security notice: no code, no link.
  return [one(user.email, template, accountCopy(name, values))];
}
