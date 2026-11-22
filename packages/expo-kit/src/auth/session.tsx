import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { type Api, ApiError, createApi, type Roles } from "@yuntera/db";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import {
  messageOf,
  SECOND_FACTOR_NOT_IN_APP,
  signInMessage,
  signUpMessage,
  validateSignIn,
  validateSignUp,
} from "../errors";
import { POLICY_VERSION } from "./policy";
import {
  CODE_REQUIRED,
  lockedMessage,
  needsSecondStep,
  normaliseCode,
  refusedMessage,
  totpFactorId,
} from "./second-step";
import { signOutDevice } from "./sign-out";

export interface Viewer {
  id: string;
  email: string | null;
  name: string | null;
}

/**
 * "secondStep": the password was right, and the account has an authenticator
 * app whose code has not been given yet. Nothing but the second step works
 * then (the database refuses the rest), so roles are not read and the app
 * shows the sign-in screen, which asks for the code (forms.tsx).
 */
export type SessionStatus = "loading" | "signedOut" | "secondStep" | "signedIn";

/**
 * Where an account with a second factor gives its code. "in-app": on the
 * second-step screen of this app. "website": this app does not ask for it;
 * such a sign-in is undone and the person is sent to the website (the
 * shopper app, until it adds the screen).
 */
export type SecondStepMode = "in-app" | "website";

export interface SessionValue {
  status: SessionStatus;
  viewer: Viewer | null;
  /** What the person may act as, read from the database (never from the token). */
  roles: Roles | null;
  /** Roles could not be read (no connection): show a retry, not "no access". */
  rolesError: string | null;
  rolesLoading: boolean;
  api: Api;
  supabase: SupabaseClient;
  /** Returns the message to show, or null when the person is signed in. */
  signIn(email: string, password: string): Promise<string | null>;
  signUp(input: {
    fullName: string;
    email: string;
    password: string;
    accepted: boolean;
  }): Promise<{ error?: string; ok?: string; signedIn?: boolean }>;
  /**
   * The second step: checks the 6-digit code from the authenticator app.
   * Returns the message to show, or null when the person is now signed in.
   */
  verifySecondStep(code: string): Promise<string | null>;
  /** Resolves to true when this phone is signed out (see signOutDevice). */
  signOut(): Promise<boolean>;
  reloadRoles(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function viewerOf(session: Session | null): Viewer | null {
  const user = session?.user;
  if (!user) return null;
  const name = (user.user_metadata as { full_name?: unknown } | undefined)?.full_name;
  return { id: user.id, email: user.email ?? null, name: typeof name === "string" ? name : null };
}

/**
 * Holds the signed-in person for the whole app: the session (kept by
 * supabase-js in the phone's secure store), and their roles, read from the
 * database after every sign-in and whenever the app returns to the screen, so
 * removing someone's role takes effect without a new sign-in.
 */
export function SessionProvider({
  supabase,
  secondStep = "website",
  children,
}: {
  supabase: SupabaseClient;
  secondStep?: SecondStepMode;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const api = useMemo(() => createApi({ rpc: (fn, args) => supabase.rpc(fn, args) }), [supabase]);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [roles, setRoles] = useState<Roles | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesLoading, setRolesLoading] = useState(false);
  // Roles belong to a session that is fully signed in, never to one halfway
  // through the second step.
  const userId = status === "signedIn" ? (session?.user.id ?? null) : null;
  const currentUser = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const statusOf = (next: Session | null): SessionStatus =>
      !next
        ? "signedOut"
        : secondStep === "in-app" && needsSecondStep(next)
          ? "secondStep"
          : "signedIn";
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setStatus(statusOf(data.session));
      })
      .catch(() => active && setStatus("signedOut"));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setStatus(statusOf(next));
      // Another person's data must never be shown from the cache.
      if (event === "SIGNED_OUT") queryClient.clear();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase, queryClient, secondStep]);

  const reloadRoles = useCallback(async () => {
    if (!currentUser.current) return;
    setRolesLoading(true);
    try {
      const next = await api.myRoles();
      setRoles(next);
      setRolesError(null);
    } catch (error) {
      // The session was ended elsewhere (signed out, password changed, account
      // deleted): the database refuses its token, so the phone signs out too
      // and removes it from the secure store. If the store refuses, the next
      // return to the screen tries again.
      if (error instanceof ApiError && error.code === "session_ended") {
        await signOutDevice(supabase.auth);
        queryClient.clear();
        return;
      }
      setRolesError(messageOf(error));
    } finally {
      setRolesLoading(false);
    }
  }, [api, supabase, queryClient]);

  useEffect(() => {
    currentUser.current = userId;
    if (!userId) {
      setRoles(null);
      setRolesError(null);
      return;
    }
    void reloadRoles();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reloadRoles();
    });
    return () => subscription.remove();
  }, [userId, reloadRoles]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const invalid = validateSignIn(email, password);
      if (invalid) return invalid;
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) return signInMessage(error);
        // An account with a second factor counts only after its code, and the
        // database refuses everything until then (check_request). An app that
        // asks for the code keeps the session halfway ("secondStep"); one that
        // does not, undoes it and sends the person to the website.
        if (secondStep === "in-app" && data.session) return null;
        const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (level?.nextLevel === "aal2" && level.currentLevel !== "aal2") {
          await signOutDevice(supabase.auth);
          return SECOND_FACTOR_NOT_IN_APP;
        }
        return null;
      } catch (error) {
        return signInMessage(error);
      }
    },
    [supabase, secondStep],
  );

  const sessionNow = useRef<Session | null>(null);
  sessionNow.current = session;
  const verifySecondStep = useCallback(
    async (raw: string) => {
      const code = normaliseCode(raw);
      if (!code) return CODE_REQUIRED;
      const factorId = totpFactorId(sessionNow.current);
      if (!factorId) return SECOND_FACTOR_NOT_IN_APP;
      try {
        // Counted before the code goes to Auth (see second-step.ts).
        const attempt = await api.mfaReserveAttempt();
        if (attempt.attempt_id === null) return lockedMessage(attempt);
        const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) return refusedMessage(error, attempt);
        // The client now holds the aal2 session; give the reservation back.
        try {
          await api.mfaAttemptSucceeded(attempt.attempt_id);
        } catch (cause) {
          console.error(
            "Could not release a second-step reservation",
            cause instanceof ApiError ? cause.code : "",
          );
        }
        return null;
      } catch (error) {
        return messageOf(error);
      }
    },
    [api, supabase],
  );

  const signUp = useCallback<SessionValue["signUp"]>(
    async (input) => {
      const invalid = validateSignUp(input);
      if (invalid) return { error: invalid };
      try {
        const { data, error } = await supabase.auth.signUp({
          email: input.email.trim(),
          password: input.password,
          // The consent given on the form travels with the account, so it is
          // recorded when the e-mail is confirmed (the confirmation link opens
          // the website's /auth/confirm) if there is no session yet.
          options: { data: { full_name: input.fullName.trim(), consent_version: POLICY_VERSION } },
        });
        if (error) return { error: signUpMessage(error) };
        if (!data.session) {
          return { ok: "Le enviamos un correo para confirmar su cuenta. Ábralo para continuar." };
        }
      } catch (error) {
        return { error: signUpMessage(error) };
      }
      // The consent given on the form, recorded against the new account. A
      // failure here does not undo the account; it is reported to the logs.
      try {
        await api.recordConsent("terms", POLICY_VERSION);
        await api.recordConsent("privacy", POLICY_VERSION);
      } catch (cause) {
        console.error("Could not record consent", cause instanceof Error ? cause.name : "");
      }
      return { signedIn: true };
    },
    [supabase, api],
  );

  const signOut = useCallback(async () => {
    // Signs the phone out even offline; false only when the secure store
    // refused to delete the session (see signOutDevice).
    const signedOut = await signOutDevice(supabase.auth);
    queryClient.clear();
    return signedOut;
  }, [supabase, queryClient]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      viewer: viewerOf(session),
      roles,
      rolesError,
      rolesLoading,
      api,
      supabase,
      signIn,
      signUp,
      verifySecondStep,
      signOut,
      reloadRoles,
    }),
    [
      status,
      session,
      roles,
      rolesError,
      rolesLoading,
      api,
      supabase,
      signIn,
      signUp,
      verifySecondStep,
      signOut,
      reloadRoles,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>.");
  return value;
}

/** The typed API over the app's Supabase client, carrying the session when there is one. */
export const useApi = (): Api => useSession().api;
