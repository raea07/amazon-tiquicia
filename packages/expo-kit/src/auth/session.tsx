import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { type Api, createApi, type Roles } from "@yuntera/db";
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
import { messageOf, signInMessage, signUpMessage, validateSignIn, validateSignUp } from "../errors";
import { POLICY_VERSION } from "./policy";
import { signOutDevice } from "./sign-out";

export interface Viewer {
  id: string;
  email: string | null;
  name: string | null;
}

export type SessionStatus = "loading" | "signedOut" | "signedIn";

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
  signOut(): Promise<void>;
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
 * supabase-js in the encrypted store), and their roles, read from the
 * database after every sign-in and whenever the app returns to the screen, so
 * removing someone's role takes effect without a new sign-in.
 */
export function SessionProvider({
  supabase,
  children,
}: {
  supabase: SupabaseClient;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const api = useMemo(() => createApi({ rpc: (fn, args) => supabase.rpc(fn, args) }), [supabase]);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [roles, setRoles] = useState<Roles | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesLoading, setRolesLoading] = useState(false);
  const userId = session?.user.id ?? null;
  const currentUser = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setStatus(data.session ? "signedIn" : "signedOut");
      })
      .catch(() => active && setStatus("signedOut"));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setStatus(next ? "signedIn" : "signedOut");
      // Another person's data must never be shown from the cache.
      if (event === "SIGNED_OUT") queryClient.clear();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase, queryClient]);

  const reloadRoles = useCallback(async () => {
    if (!currentUser.current) return;
    setRolesLoading(true);
    try {
      const next = await api.myRoles();
      setRoles(next);
      setRolesError(null);
    } catch (error) {
      setRolesError(messageOf(error));
    } finally {
      setRolesLoading(false);
    }
  }, [api]);

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
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        return error ? signInMessage(error) : null;
      } catch (error) {
        return signInMessage(error);
      }
    },
    [supabase],
  );

  const signUp = useCallback<SessionValue["signUp"]>(
    async (input) => {
      const invalid = validateSignUp(input);
      if (invalid) return { error: invalid };
      try {
        const { data, error } = await supabase.auth.signUp({
          email: input.email.trim(),
          password: input.password,
          options: { data: { full_name: input.fullName.trim() } },
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
    // Never leaves the phone signed in, even offline (see signOutDevice).
    await signOutDevice(supabase.auth);
    queryClient.clear();
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
