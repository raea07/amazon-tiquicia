/**
 * The two ways of sending account e-mails say the same thing and build the
 * same link and code: Supabase Auth's own templates (supabase/templates) and
 * the Send Email Hook (./auth.ts), both checked against ./account-texts.ts.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT_EMAILS, type AccountEmailName, TEMPLATE_FOR_ACTION } from "./account-texts.ts";
import { authEmails } from "./auth.ts";
import type { Sender } from "./render.ts";

const TEMPLATES = fileURLToPath(new URL("../../../../supabase/templates/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${TEMPLATES}templates.json`, "utf8")) as {
  templates: Record<string, { subject: string; file: string }>;
};

const GO_PLACEHOLDERS: Record<string, string> = {
  "{{ .Email }}": "{email}",
  "{{ .NewEmail }}": "{new_email}",
  "{{ .OldEmail }}": "{old_email}",
  "{{ .Token }}": "{token}",
};
const fromGo = (text: string) =>
  Object.entries(GO_PLACEHOLDERS).reduce((t, [go, ours]) => t.split(go).join(ours), text);

/** The template's words, without markup, one space between words. */
function templateText(file: string): string {
  const html = readFileSync(`${TEMPLATES}${file}`, "utf8");
  return fromGo(
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " "),
  );
}

const sender: Sender = {
  legalName: "Yuntera S.A.",
  legalId: "cédula jurídica 3-101-000000",
  postalAddress: "San José, Costa Rica",
  replyTo: "ayuda@yuntera.cr",
};

const names = Object.keys(ACCOUNT_EMAILS) as AccountEmailName[];

describe("Auth's templates and the shared words", () => {
  it("cover the same e-mails", () => {
    expect(Object.keys(manifest.templates).sort()).toEqual([...names].sort());
  });

  for (const name of names) {
    const t = ACCOUNT_EMAILS[name];
    it(`${name}: same subject and every sentence, word for word`, () => {
      const entry = manifest.templates[name];
      expect(entry).toBeDefined();
      expect(fromGo(entry?.subject ?? "")).toBe(t.subject);
      const text = templateText(entry?.file ?? "");
      for (const sentence of [t.heading, t.intro, t.note, ...("button" in t ? [t.button] : [])]) {
        expect(text).toContain(sentence);
      }
      if ("codeLine" in t) {
        expect(text).toContain(t.codeLine);
        expect(text).toContain(t.expiry);
      }
    });

    if ("linkType" in t) {
      it(`${name}: the link is the app's /auth/confirm with token_hash and type=${t.linkType}`, () => {
        const html = readFileSync(`${TEMPLATES}${manifest.templates[name]?.file}`, "utf8");
        // RedirectTo is the app's /auth/confirm address (every app passes it);
        // the fallback is the shop's own.
        expect(html).toContain(
          `href="{{ if .RedirectTo }}{{ .RedirectTo }}{{ else }}{{ .SiteURL }}/auth/confirm{{ end }}?token_hash={{ .TokenHash }}&amp;type=${t.linkType}"`,
        );
        expect(html).toContain("{{ .Token }}");
      });
    }
  }
});

describe("the Send Email Hook and the shared words", () => {
  const actions = Object.entries(TEMPLATE_FOR_ACTION);
  const payload = (type: string) => ({
    user: { id: "u1", email: "ana@correo.cr", new_email: "ana.nueva@correo.cr" },
    email_data: {
      token: "305805",
      token_hash: "hash-a",
      redirect_to: "https://vender.yuntera.cr/auth/confirm",
      email_action_type: type,
      site_url: "https://www.yuntera.cr",
      old_email: "ana.vieja@correo.cr",
    },
  });

  for (const [action, name] of actions) {
    it(`${action}: says what the ${name} template says`, () => {
      const t = ACCOUNT_EMAILS[name];
      const mails = authEmails(payload(action), sender);
      expect(mails).toHaveLength(1);
      const mail = mails[0];
      const values: Record<string, string> = {
        email: "ana@correo.cr",
        new_email: "ana.nueva@correo.cr",
        old_email: "ana.vieja@correo.cr",
        token: "305805",
      };
      const filled = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
      const text = (mail?.rendered.text ?? "").replace(/\s+/g, " ");
      expect(mail?.rendered.subject).toBe(filled(t.subject));
      for (const sentence of [t.heading, filled(t.intro), t.note]) {
        expect(text).toContain(sentence);
      }
      if ("codeLine" in t) {
        expect(text).toContain(t.codeLine);
        expect(text).toContain(t.expiry);
        expect(text).toContain("305805");
        expect(text).toContain(t.button);
        // The same link Auth's template builds from this redirect_to.
        expect(text).toContain(
          `https://vender.yuntera.cr/auth/confirm?token_hash=hash-a&type=${t.linkType}`,
        );
      }
      if (name === "reauthentication") expect(text).toContain("305805");
    });
  }
});
