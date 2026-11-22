import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useSession } from "../auth/session";
import { useApiQuery } from "../data/hooks";
import { colors, radius, space } from "../theme/tokens";
import { Button } from "../ui/button";
import { Alert, ErrorState, FormMessage, LoadingState } from "../ui/feedback";
import { Checkbox, TextField } from "../ui/fields";
import { CheckIcon } from "../ui/icons";
import { Card, Screen, Stack } from "../ui/layout";
import { Text } from "../ui/text";
import { accountDeletedNotice } from "./deleted";
import { changePassword, deleteAccount, requestPasswordReset } from "./flows";
import {
  ACCOUNT_DELETED,
  blockerMessages,
  DELETION_CONFIRM_LABEL,
  DELETION_ON_THIS_PHONE,
  DELETION_TERMS,
  ordersKeptText,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  RESET_NEXT,
} from "./rules";

/**
 * The account screens every app shows the same way: forgotten password,
 * password change, and account deletion, with the websites' rules and words
 * (rules.ts) and steps (flows.ts). Each app puts them on its own routes.
 */

// ── Password rules ──────────────────────────────────────────────────────────

/**
 * The password rules, shown before anything is sent and ticked off as the
 * person types. Each line says in words whether it is met: colour is never
 * the only signal.
 */
export function PasswordRules({ password, repeat }: { password: string; repeat?: string }) {
  const rows = [
    { text: PASSWORD_RULES[0], ok: [...password].length >= PASSWORD_MIN_LENGTH, checked: true },
    { text: PASSWORD_RULES[1], ok: true, checked: false },
    ...(repeat === undefined
      ? []
      : [
          {
            text: "Las dos contraseñas iguales.",
            ok: repeat !== "" && repeat === password,
            checked: true,
          },
        ]),
  ];
  return (
    <View aria-label="Requisitos de la contraseña" style={{ gap: space[1] }}>
      {rows.map((row) => {
        const met = row.checked && row.ok;
        return (
          <View
            key={row.text}
            style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                marginTop: 2,
                borderRadius: radius.full,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: met ? colors.success : "transparent",
                borderWidth: met ? 0 : 1,
                borderColor: colors.fieldBorder,
              }}
            >
              {met ? <CheckIcon size={14} color={colors.onBrand} /> : null}
            </View>
            <Text variant="small" tint={met ? "ink" : "muted"} style={{ flex: 1 }}>
              {row.text}
              {row.checked ? (met ? " Cumple." : " Todavía no cumple.") : ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Forgotten password ──────────────────────────────────────────────────────

/**
 * "Olvidé mi contraseña": the address, then the same answer whatever it is.
 * The link in the e-mail opens the website, where the new password is set;
 * the person then comes back and signs in here.
 */
export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const { supabase } = useSession();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function send() {
    if (busy) return;
    setBusy(true);
    setResult({});
    // No redirect is named: the link opens the site's own /auth/confirm, the
    // shop website, where any Yuntera account sets its new password.
    const outcome = await requestPasswordReset(
      { resetPasswordForEmail: (address) => supabase.auth.resetPasswordForEmail(address) },
      email,
    );
    setBusy(false);
    setResult(outcome);
  }

  if (result.ok) {
    return (
      <Stack gap={4}>
        <Text variant="title">Revise su correo</Text>
        <Alert tone="success" testID="reset-sent">
          {result.ok}
        </Alert>
        <Text testID="reset-next">{RESET_NEXT}</Text>
        <Button block size="lg" onPress={onBack} testID="reset-back">
          Volver a ingresar
        </Button>
        <Button
          variant="ghost"
          block
          loading={busy}
          loadingLabel="Enviando…"
          onPress={send}
          testID="reset-again"
        >
          Enviarme otro correo
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap={4}>
      <Text variant="title">Restablecer su contraseña</Text>
      <Text tint="muted">
        Escriba el correo con el que ingresa. Le enviaremos un enlace para elegir una contraseña
        nueva.
      </Text>
      <TextField
        label="Correo electrónico de su cuenta"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        inputMode="email"
        textContentType="username"
        returnKeyType="send"
        onSubmitEditing={send}
        testID="reset-email"
      />
      <FormMessage error={result.error} testID="reset-message" />
      <Button
        block
        size="lg"
        loading={busy}
        loadingLabel="Enviando…"
        onPress={send}
        testID="reset-submit"
      >
        Enviarme un enlace
      </Button>
      <Button variant="ghost" block onPress={onBack} testID="reset-cancel">
        ¿Se acordó? Volver a ingresar
      </Button>
    </Stack>
  );
}

// ── Password change while signed in ─────────────────────────────────────────

/** Current password, the new one twice with the rules underneath. As the web's Mi cuenta. */
export function ChangePasswordForm() {
  const { viewer, supabase, checkPassword } = useSession();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setResult({});
    const outcome = await changePassword(
      { email: viewer?.email ?? null, current, password, repeat },
      {
        check: checkPassword,
        auth: { updateUser: (attributes) => supabase.auth.updateUser(attributes) },
      },
    );
    setBusy(false);
    setResult(outcome);
    setCurrent("");
    if (outcome.ok) {
      setPassword("");
      setRepeat("");
    }
  }

  return (
    <Stack gap={4}>
      <TextField
        label="Contraseña actual"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        testID="password-current"
      />
      <TextField
        label="Contraseña nueva"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        testID="password-new"
      />
      <TextField
        label="Escríbala de nuevo"
        value={repeat}
        onChangeText={setRepeat}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        testID="password-repeat"
      />
      <PasswordRules password={password} repeat={repeat} />
      <FormMessage error={result.error} ok={result.ok} testID="password-message" />
      <Button loading={busy} loadingLabel="Guardando…" onPress={submit} testID="password-submit">
        Cambiar la contraseña
      </Button>
    </Stack>
  );
}

// ── Account deletion ────────────────────────────────────────────────────────

/** What deleting an account erases and what the law makes Yuntera keep. */
export function DeletionTerms() {
  return (
    <View style={{ gap: space[4] }} testID="deletion-terms">
      <Stack gap={2}>
        <Text variant="subheading">{DELETION_TERMS.erased.title}</Text>
        {DELETION_TERMS.erased.items.map((item) => (
          <View key={item} style={{ flexDirection: "row", gap: space[2] }}>
            <Text aria-hidden>•</Text>
            <Text style={{ flex: 1 }}>{item}</Text>
          </View>
        ))}
      </Stack>
      <Stack gap={2}>
        <Text variant="subheading">{DELETION_TERMS.kept.title}</Text>
        <Text>{DELETION_TERMS.kept.text}</Text>
      </Stack>
      <Stack gap={2}>
        <Text variant="subheading">{DELETION_TERMS.after.title}</Text>
        <Text>{DELETION_TERMS.after.text}</Text>
        <Text>{DELETION_ON_THIS_PHONE}</Text>
      </Stack>
    </View>
  );
}

/**
 * Eliminar su cuenta, as the websites' /cuenta/eliminar: what is erased and
 * kept, what stands in the way (and what to do about it), and, when nothing
 * does, the password again and an unticked box. Once the database has
 * deleted the account, `forgetDevice` removes what this app keeps of it
 * beyond the session, the session leaves the secure store, the data cache is
 * emptied, and the app returns to its start screen, which says so
 * (AccountDeletedNotice).
 */
export function DeleteAccountScreenBody({
  forgetDevice,
  onCancel,
}: {
  forgetDevice?: () => Promise<void>;
  onCancel: () => void;
}) {
  const { api, supabase, viewer, checkPassword } = useSession();
  const queryClient = useQueryClient();
  const check = useApiQuery(["account", "deletion-check"], (a) => a.accountDeletionCheck(), {
    personal: true,
    // Always the database's answer of now: a blocker may have just cleared.
    staleTime: 0,
  });
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const outcome = await deleteAccount(
      { email: viewer?.email ?? null, password, understood },
      {
        check: checkPassword,
        deleteMyAccount: () => api.deleteMyAccount(),
        forgetDevice: async () => {
          // Said on the start screen the sign-out below returns to.
          accountDeletedNotice.mark();
          await forgetDevice?.();
        },
        // Local only: the database has already ended every session of the
        // account, so a global sign-out has nothing left to end.
        signOutDevice: async () => {
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch {
            // Read back below.
          }
          const { data } = await supabase.auth.getSession();
          return data.session === null;
        },
        clearMemory: () => queryClient.clear(),
      },
    );
    setBusy(false);
    setPassword("");
    if ("error" in outcome) {
      setError(outcome.error);
      return;
    }
    if (!outcome.signedOut) {
      setError(
        "Su cuenta fue eliminada, pero este teléfono no pudo borrar la sesión guardada. Cierre la aplicación y ábrala de nuevo.",
      );
    }
  }

  if (check.isPending) return <LoadingState />;
  if (check.isError) return <ErrorState error={check.error} onRetry={() => void check.refetch()} />;
  const { blockers, orders_kept } = check.data;

  return (
    <Stack gap={5}>
      <Card>
        <DeletionTerms />
      </Card>
      {blockers.length > 0 ? (
        <Alert
          tone="warning"
          title="Todavía no podemos eliminar su cuenta"
          testID="deletion-blockers"
        >
          <Stack gap={2}>
            {blockerMessages(blockers).map((message) => (
              <View key={message} style={{ flexDirection: "row", gap: space[2] }}>
                <Text variant="small" aria-hidden style={{ color: colors.ink }}>
                  •
                </Text>
                <Text variant="small" style={{ flex: 1, color: colors.ink }}>
                  {message}
                </Text>
              </View>
            ))}
            <Text variant="small" style={{ color: colors.ink }}>
              Cuando se resuelva, vuelva a esta pantalla.
            </Text>
          </Stack>
        </Alert>
      ) : (
        <Card testID="deletion-confirm">
          <Text variant="heading">Confirmar</Text>
          <Text tint="muted" testID="deletion-kept">
            {ordersKeptText(orders_kept)}
          </Text>
          <TextField
            label="Su contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            hint="La pedimos de nuevo para confirmar que es usted."
            testID="delete-password"
          />
          {/* Unticked by default: deleting has to be something the person does. */}
          <Checkbox checked={understood} onChange={setUnderstood} testID="delete-understood">
            <Text variant="small">{DELETION_CONFIRM_LABEL}</Text>
          </Checkbox>
          <FormMessage error={error} testID="delete-message" />
          <Button
            variant="danger"
            block
            loading={busy}
            loadingLabel="Eliminando…"
            onPress={submit}
            testID="delete-submit"
          >
            Eliminar mi cuenta para siempre
          </Button>
        </Card>
      )}
      <Button variant="secondary" block onPress={onCancel} testID="delete-cancel">
        Volver a su cuenta sin eliminarla
      </Button>
    </Stack>
  );
}

/**
 * The whole deletion screen, for an app whose root navigator shows it outside
 * its own header (the seller, driver and warehouse apps: it is reachable
 * from the screen for an account the app is not for, too). `back` is where
 * "Volver" goes when there is no screen underneath.
 */
export function DeleteAccountScreen({
  forgetDevice,
  back = "/",
}: {
  forgetDevice?: () => Promise<void>;
  back?: string;
}) {
  return (
    <Screen edges={["top", "bottom", "left", "right"]} testID="delete-account">
      <Text variant="title">Eliminar su cuenta</Text>
      <DeleteAccountScreenBody
        forgetDevice={forgetDevice}
        onCancel={() => (router.canGoBack() ? router.back() : router.replace(back as never))}
      />
    </Screen>
  );
}

/** "Su cuenta fue eliminada", once, on the start screen after a deletion. */
export function AccountDeletedNotice() {
  const deleted = useSyncExternalStore(
    accountDeletedNotice.subscribe,
    accountDeletedNotice.current,
    accountDeletedNotice.current,
  );
  if (!deleted) return null;
  return (
    <Alert tone="success" title={ACCOUNT_DELETED.title} testID="account-deleted">
      <Stack gap={2}>
        <Text variant="small" style={{ color: colors.ink }}>
          {ACCOUNT_DELETED.text}
        </Text>
        <Text variant="small" style={{ color: colors.ink }}>
          {ACCOUNT_DELETED.again}
        </Text>
        <Button variant="secondary" onPress={() => accountDeletedNotice.dismiss()}>
          Entendido
        </Button>
      </Stack>
    </Alert>
  );
}
