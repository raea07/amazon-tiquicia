/**
 * E-mails the real service would send, rendered from the same template files
 * the hosted project uses (supabase/templates, applied there by
 * supabase/scripts/auth-config.sh) and dropped into a local mailbox
 * (dev_standin.mailbox) instead of being sent. Browser journeys read the
 * mailbox through GET /dev/mail.
 *
 * The renderer understands only what our templates use: `{{ .Name }}` and
 * `{{ if .Name }}…{{ else }}…{{ end }}`. Supabase renders them as Go templates.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "../context.ts";

const DIR = fileURLToPath(new URL("../../../../supabase/templates/", import.meta.url));

interface Catalogue {
  layout: string;
  templates: Record<string, { subject: string; file: string }>;
}

export type TemplateName =
  | "confirmation"
  | "recovery"
  | "email_change"
  | "magic_link"
  | "invite"
  | "reauthentication"
  | "password_changed_notification"
  | "email_changed_notification"
  | "mfa_factor_enrolled_notification"
  | "mfa_factor_unenrolled_notification";

export type TemplateData = Record<string, string>;

export function render(template: string, data: TemplateData): string {
  const value = (name: string) => data[name] ?? "";
  const conditional =
    /\{\{-?\s*if\s+\.(\w+)\s*-?\}\}([\s\S]*?)(?:\{\{-?\s*else\s*-?\}\}([\s\S]*?))?\{\{-?\s*end\s*-?\}\}/g;
  return template
    .replace(conditional, (_all, name: string, yes: string, no = "") => (value(name) ? yes : no))
    .replace(/\{\{-?\s*\.(\w+)\s*-?\}\}/g, (_all, name: string) => value(name));
}

/** Layout plus the template's own content, as auth-config.sh assembles them. */
export function compose(name: TemplateName): { subject: string; html: string } {
  const catalogue = JSON.parse(readFileSync(`${DIR}templates.json`, "utf8")) as Catalogue;
  const entry = catalogue.templates[name];
  if (!entry) throw new Error(`no template ${name}`);
  const layout = readFileSync(`${DIR}${catalogue.layout}`, "utf8");
  const content = readFileSync(`${DIR}${entry.file}`, "utf8");
  return { subject: entry.subject, html: layout.replace("<!-- CONTENT -->", content) };
}

/** The first link in the message that carries a token hash. */
export function tokenLink(html: string): string | null {
  const match = /href="([^"]*token_hash=[^"]*)"/.exec(html);
  return match?.[1] ? match[1].replaceAll("&amp;", "&") : null;
}

export async function sendMail(to: string, name: TemplateName, data: TemplateData): Promise<void> {
  const { subject, html } = compose(name);
  const body = render(html, { ...data, Email: data.Email ?? to });
  await pool.query(
    `insert into dev_standin.mailbox (to_address, kind, subject, body, token, token_hash, link)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      to,
      name,
      render(subject, data),
      body,
      data.Token ?? null,
      data.TokenHash ?? null,
      tokenLink(body),
    ],
  );
}
