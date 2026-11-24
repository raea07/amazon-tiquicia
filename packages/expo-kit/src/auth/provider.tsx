import { QueryClientProvider } from "@tanstack/react-query";
import { SplashScreen } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createQueryClient, type QueryClientOptions, wireAppLifecycle } from "../data/query-client";
import { getSupabase, type PublicEnv } from "../supabase/client";
import { useBrandFonts } from "../ui/fonts";
import { type SecondStepMode, SessionProvider, useSession } from "./session";

// Keep the splash screen up until the session has been read from storage, so
// nobody sees a signed-out screen flash before their own.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function HideSplashWhenReady({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const fontsReady = useBrandFonts();
  const ready = status !== "loading" && fontsReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return ready ? children : null;
}

/**
 * Everything an app needs around its screens: safe areas, the data cache,
 * the Supabase client with its session in the secure store, the signed-in person and
 * their roles, and the brand's fonts. Each app's root `_layout.tsx` wraps its
 * navigator in this, passing the public settings it was built with.
 *
 * `secondStep` says where an account with an authenticator app gives its
 * code (session.tsx): "in-app" on this app's sign-in screen (the seller,
 * driver and warehouse apps), "website" by default.
 *
 * `readTimeoutMs` makes a read that never answers fail after that long, so
 * the screen's error state or notice, with "Intentar de nuevo", takes over
 * (data/query-client.ts). Apps that do not pass it keep waiting as before.
 */
export function AppProviders({
  env,
  secondStep,
  readTimeoutMs,
  children,
}: {
  env: PublicEnv;
  secondStep?: SecondStepMode;
  readTimeoutMs?: QueryClientOptions["readTimeoutMs"];
  children: ReactNode;
}) {
  const [queryClient] = useState(() => createQueryClient({ readTimeoutMs }));
  const supabase = getSupabase(env);
  useEffect(wireAppLifecycle, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider supabase={supabase} env={env} secondStep={secondStep}>
          <StatusBar style="dark" />
          <HideSplashWhenReady>{children}</HideSplashWhenReady>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
