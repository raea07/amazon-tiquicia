import { type AppId, apps } from "@yuntera/brand";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { accountDeletedNotice } from "../account/deleted";
import { AccountDeletedNotice, ForgotPasswordForm } from "../account/screens";
import { SIGN_OUT_FAILED } from "../errors";
import { Button, LinkButton } from "../ui/button";
import { FormMessage } from "../ui/feedback";
import { Checkbox, TextField } from "../ui/fields";
import { Card, Screen, Stack } from "../ui/layout";
import { Logo } from "../ui/logo";
import { Text } from "../ui/text";
import { noAccessText } from "./roles";
import { useSession } from "./session";

/**
 * E-mail and password, as on the web. One message for every wrong
 * combination; the e-mail stays, the password is cleared after a failure.
 * `onForgotPassword` adds "Olvidé mi contraseña", which the screen answers
 * by showing ForgotPasswordForm (account/screens.tsx) in its place.
 */
export function SignInForm({
  onSignedIn,
  onForgotPassword,
}: {
  onSignedIn?: () => void;
  onForgotPassword?: () => void;
}) {
  const { status } = useSession();
  // The password was right and the account has an authenticator app: the
  // same place asks for its code.
  if (status === "secondStep") return <SecondStepForm onSignedIn={onSignedIn} />;
  return <PasswordForm onSignedIn={onSignedIn} onForgotPassword={onForgotPassword} />;
}

function PasswordForm({
  onSignedIn,
  onForgotPassword,
}: {
  onSignedIn?: () => void;
  onForgotPassword?: () => void;
}) {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) {
      setError(message);
      setPassword("");
      return;
    }
    accountDeletedNotice.dismiss();
    onSignedIn?.();
  }

  return (
    <Stack gap={4}>
      <TextField
        label="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        inputMode="email"
        returnKeyType="next"
        testID="sign-in-email"
      />
      <TextField
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="sign-in-password"
      />
      <FormMessage error={error} testID="sign-in-message" />
      <Button
        block
        size="lg"
        loading={busy}
        loadingLabel="Ingresando…"
        onPress={submit}
        testID="sign-in-submit"
      >
        Ingresar
      </Button>
      {onForgotPassword ? (
        <Button variant="ghost" block onPress={onForgotPassword} testID="forgot-password">
          Olvidé mi contraseña
        </Button>
      ) : null}
    </Stack>
  );
}

/**
 * The second step of a sign-in (second-step.ts has the rules): the 6-digit
 * code from the person's authenticator app, as on the website's
 * /ingresar/verificar. A wrong code says how many tries are left; after five
 * the database pauses the account and the message says for how long. The
 * code lives only in this field and is cleared after every attempt.
 */
export function SecondStepForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const { verifySecondStep, viewer } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await verifySecondStep(code);
    setBusy(false);
    setCode("");
    if (message) {
      setError(message);
      return;
    }
    onSignedIn?.();
  }

  return (
    <View style={{ gap: 16 }} testID="second-step">
      <Text variant="heading">Verificación en dos pasos</Text>
      <Text>
        Abra su aplicación de autenticación y escriba el código de 6 dígitos que muestra para
        Yuntera.
      </Text>
      {viewer?.email ? (
        <Text variant="small" tint="muted">
          Ingresando como {viewer.email}.
        </Text>
      ) : null}
      <TextField
        label="Código de 6 dígitos"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={7}
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="second-step-code"
      />
      <FormMessage error={error} testID="second-step-message" />
      <Button
        block
        size="lg"
        loading={busy}
        loadingLabel="Comprobando…"
        onPress={submit}
        testID="second-step-submit"
      >
        Confirmar el código
      </Button>
      <SignOutButton label="Cancelar e ingresar con otra cuenta" testID="second-step-cancel" />
    </View>
  );
}

/**
 * "Cerrar sesión", saying so when the phone could not be signed out (the
 * session provider's signOut resolves to false: the secure store refused to
 * delete the session, which stays readable). `signOut` replaces the
 * provider's when an app clears more of its own first (the drivers' app).
 */
export function SignOutButton({
  signOut,
  label = "Cerrar sesión",
  testID = "sign-out",
}: {
  signOut?: () => Promise<boolean>;
  label?: string;
  testID?: string;
}) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Stack gap={2}>
      {failed ? <FormMessage error={SIGN_OUT_FAILED} testID={`${testID}-message`} /> : null}
      <Button
        variant="ghost"
        block
        loading={busy}
        loadingLabel="Cerrando sesión…"
        onPress={async () => {
          if (busy) return;
          setBusy(true);
          setFailed(false);
          const done = await (signOut ?? session.signOut)();
          setBusy(false);
          setFailed(!done);
        }}
        testID={testID}
      >
        {label}
      </Button>
    </Stack>
  );
}

/**
 * Creates an account. The consent box starts unticked and must be ticked by
 * the person; `legal` is the line with the links to the terms and the policy.
 */
export function SignUpForm({ onSignedIn, legal }: { onSignedIn?: () => void; legal: ReactNode }) {
  const { signUp } = useSession();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [result, setResult] = useState<{ error?: string; ok?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const outcome = await signUp({ fullName, email, password, accepted });
    setBusy(false);
    setResult(outcome);
    if (outcome.signedIn) {
      accountDeletedNotice.dismiss();
      onSignedIn?.();
    }
  }

  return (
    <Stack gap={4}>
      <TextField
        label="Nombre completo"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        testID="sign-up-name"
      />
      <TextField
        label="Correo electrónico"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        inputMode="email"
        testID="sign-up-email"
      />
      <TextField
        label="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        hint="Al menos 8 caracteres."
        testID="sign-up-password"
      />
      <Checkbox checked={accepted} onChange={setAccepted} testID="sign-up-consent">
        {legal}
      </Checkbox>
      <FormMessage error={result.error} ok={result.ok} />
      <Button
        block
        size="lg"
        loading={busy}
        loadingLabel="Creando su cuenta…"
        onPress={submit}
        testID="sign-up-submit"
      >
        Crear cuenta
      </Button>
    </Stack>
  );
}

/** The whole sign-in screen of a staff-facing app (seller, driver, warehouse). */
export function SignInScreen({ app }: { app: AppId }) {
  const identity = apps[app];
  const { status } = useSession();
  const [recovering, setRecovering] = useState(false);
  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <View style={{ flex: 1, justifyContent: "center", gap: 24 }}>
        <Logo app={app} size={36} />
        <AccountDeletedNotice />
        <Card>
          {recovering && status === "signedOut" ? (
            <ForgotPasswordForm onBack={() => setRecovering(false)} />
          ) : (
            <>
              <Text variant="title">Ingresar</Text>
              {status === "secondStep" ? null : (
                <Text tint="muted">
                  Con el correo y la contraseña de su cuenta de {identity.name}.
                </Text>
              )}
              <SignInForm onForgotPassword={() => setRecovering(true)} />
            </>
          )}
        </Card>
      </View>
    </Screen>
  );
}

/**
 * Shown to a signed-in account that this app is not for: what happened, what
 * to do, and a way out. The database would refuse it anyway; this says so
 * kindly. `deleteHref` adds the way to delete the account (both stores
 * require it in the app, whatever the account is for).
 */
export function NoAccessScreen({
  app,
  deleteHref,
}: {
  app: Exclude<AppId, "shop" | "ops">;
  deleteHref?: string;
}) {
  const { viewer, reloadRoles, rolesLoading, roles, rolesError } = useSession();
  // Roles that could not be read (no connection) are not a "no": say what happened instead.
  const text =
    !roles && rolesError
      ? { title: "No pudimos revisar su acceso", body: `${rolesError} Su cuenta no cambió.` }
      : noAccessText(app, roles);
  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <View style={{ flex: 1, justifyContent: "center", gap: 20 }} testID="no-access">
        <Logo app={app} size={32} />
        <Text variant="title">{text.title}</Text>
        <Text>{text.body}</Text>
        {viewer?.email ? (
          <Text variant="small" tint="muted">
            Ingresó como {viewer.email}.
          </Text>
        ) : null}
        <Stack gap={3}>
          <Button
            variant="secondary"
            block
            loading={rolesLoading}
            loadingLabel="Revisando…"
            onPress={() => void reloadRoles()}
          >
            {!roles && rolesError ? "Intentar de nuevo" : "Ya me dieron acceso: revisar de nuevo"}
          </Button>
          <SignOutButton label="Salir e ingresar con otra cuenta" testID="no-access-sign-out" />
          {deleteHref && roles ? (
            <LinkButton href={deleteHref as never} variant="ghost" block testID="no-access-delete">
              Eliminar mi cuenta
            </LinkButton>
          ) : null}
        </Stack>
      </View>
    </Screen>
  );
}
