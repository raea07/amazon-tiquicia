import "server-only";
import { cookies, headers } from "next/headers";
import {
  accountHash,
  addressHash,
  clientAddress,
  ENDED_COOKIE,
  endedSessionMessage,
  guardKey,
  isKnownDevice,
  KNOWN_DEVICE_COOKIE,
  type LimitedAction,
  limitMessage,
  rememberDevice,
  userHash,
} from "../guard";
import { SESSION_COOKIE } from "./supabase";
import { visitorApi } from "./visitor-api";

/**
 * The apps' own limit in front of every call to Auth that a visitor can repeat
 * (WEB-2): sign-in, sign-up, reset and confirmation e-mails, e-mailed codes and
 * the current password asked again. Counted in the database
 * (`auth_limit_reserve`), so it holds across server instances and all four
 * apps; see supabase/migrations/20261121083300_web_followups.sql for the
 * numbers.
 *
 * Usage, in a Server Action:
 *
 *   const attempt = await reserveAttempt("sign_in", { email });
 *   if ("error" in attempt) return { error: attempt.error, values };
 *   … call Auth …
 *   if (it worked) await attempt.succeeded();
 *
 * Fails closed: without a usable AUTH_GUARD_KEY outside a local run, or when
 * the database cannot be asked, nothing goes to Auth.
 */

const GENERIC = "Algo salió mal de nuestro lado. Inténtelo de nuevo en un momento.";

export type Reservation = { error: string } | { attemptId: string; succeeded: () => Promise<void> };

let warnedNoAddress = false;

/** The keyed hash of the visitor's address, or null when no header may be trusted (see guard.ts). */
export async function visitorAddressHash(key: string): Promise<string | null> {
  const address = clientAddress(await headers(), process.env);
  if (!address && !warnedNoAddress) {
    warnedNoAddress = true;
    if (process.env.VERCEL || process.env.AUTH_CLIENT_IP_HEADER) {
      console.error("Sign-in limit: the request carried no usable visitor address.");
    } else {
      console.warn(
        "Sign-in limit: no trusted header for the visitor's address here (set AUTH_CLIENT_IP_HEADER " +
          "behind a proxy); counting per account only.",
      );
    }
  }
  return address ? addressHash(key, address) : null;
}

export async function reserveAttempt(
  action: LimitedAction,
  who: { email?: string; userId?: string },
): Promise<Reservation> {
  const key = guardKey(process.env);
  if (!key.ok) {
    console.error(`Sign-in limit refused to run: ${key.reason}.`);
    return { error: GENERIC };
  }
  const api = visitorApi();
  if (!api) return { error: GENERIC };
  const account = who.userId
    ? userHash(key.value, who.userId)
    : who.email
      ? accountHash(key.value, who.email)
      : null;
  const address = await visitorAddressHash(key.value);
  // Nothing to count by (a link, where no visitor address can be trusted):
  // there is no bucket that would not be everybody's.
  if (!account && !address) return { attemptId: "", succeeded: async () => undefined };
  const knownDevice =
    action === "sign_in" && account !== null
      ? isKnownDevice(key.value, (await cookies()).get(KNOWN_DEVICE_COOKIE)?.value, account)
      : false;

  let reservation: Awaited<ReturnType<typeof api.authLimitReserve>>;
  try {
    reservation = await api.authLimitReserve({
      action,
      addressHash: address,
      accountHash: account,
      knownDevice,
    });
  } catch (error) {
    console.error("Sign-in limit could not be asked", error);
    return { error: GENERIC };
  }
  const attemptId = reservation.attempt_id;
  if (attemptId === null) return { error: limitMessage(action, reservation.retry_after_seconds) };
  return {
    attemptId,
    succeeded: async () => {
      try {
        await api.authLimitRelease(attemptId);
      } catch (error) {
        console.error("Sign-in limit: a successful attempt could not be given back", error);
      }
      if (action === "sign_in" && account) await rememberThisDevice(key.value, account);
    },
  };
}

/** After a right password: this browser may skip the account's own limit next time. */
async function rememberThisDevice(key: string, account: string): Promise<void> {
  const store = await cookies();
  store.set(
    KNOWN_DEVICE_COOKIE,
    rememberDevice(key, store.get(KNOWN_DEVICE_COOKIE)?.value, account),
    {
      ...SESSION_COOKIE,
      maxAge: 180 * 24 * 3600,
    },
  );
  // The note "your session ended" has done its job.
  store.delete(ENDED_COOKIE);
}

/**
 * The token of the optional human check (Cloudflare Turnstile, which Auth
 * verifies when CAPTCHA protection is switched on in the project). The widget
 * puts it in this field; without the widget there is none and Auth, with the
 * protection off, does not ask for one.
 */
export function captchaToken(formData: FormData): string | undefined {
  const value = formData.get("cf-turnstile-response");
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Why the person is on the sign-in page, when the proxy has just ended their
 * session (too long, or idle in the console), or null. Reads a cookie: call
 * inside <Suspense>.
 */
export async function endedSessionNotice(): Promise<string | null> {
  return endedSessionMessage((await cookies()).get(ENDED_COOKIE)?.value);
}
