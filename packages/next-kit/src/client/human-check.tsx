"use client";

import { useEffect, useRef } from "react";

/**
 * The optional human check on the forms that send a password or an e-mail to
 * Auth: Cloudflare Turnstile, which Supabase Auth verifies once its CAPTCHA
 * protection is switched on. It stays off (renders nothing) until the public
 * site key NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY is set when the app is built; the
 * runbook says how to turn both on together. Turnstile writes its token into a
 * hidden `cf-turnstile-response` field of the form, which the Server Action
 * passes to Auth as `captchaToken`.
 *
 * A token works once, so the check is reset whenever `resetKey` changes (pass
 * the form's last answer).
 */

interface Turnstile {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  reset(widget: string): void;
  remove(widget: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The human check could not load."));
    document.head.appendChild(script);
  });
  return loading;
}

export function HumanCheck({ resetKey }: { resetKey?: unknown }) {
  const siteKey = process.env.NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY;
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          language: "es",
          "response-field-name": "cf-turnstile-response",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey !== undefined && widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  if (!siteKey) return null;
  return (
    <div>
      <p className="text-sm text-ink-muted">Confirme que es una persona para continuar.</p>
      <div ref={box} className="mt-2 min-h-16" />
    </div>
  );
}
