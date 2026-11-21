import { type AppId, apps } from "@yuntera/brand";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { Button } from "../ui/button";
import { FormMessage } from "../ui/feedback";
import { Checkbox, TextField } from "../ui/fields";
import { Card, Screen, Stack } from "../ui/layout";
import { Logo } from "../ui/logo";
import { Text } from "../ui/text";
import { NO_ACCESS } from "./roles";
import { useSession } from "./session";

/**
 * E-mail and password, as on the web. One message for every wrong
 * combination; the e-mail stays, the password is cleared after a failure.
 */
export function SignInForm({ onSignedIn }: { onSignedIn?: () => void }) {
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
    if (outcome.signedIn) onSignedIn?.();
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
  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <View style={{ flex: 1, justifyContent: "center", gap: 24 }}>
        <Logo app={app} size={36} />
        <Card>
          <Text variant="title">Ingresar</Text>
          <Text tint="muted">Con el correo y la contraseña de su cuenta de {identity.name}.</Text>
          <SignInForm />
        </Card>
      </View>
    </Screen>
  );
}

/**
 * Shown to a signed-in account that this app is not for: what happened, what
 * to do, and a way out. The database would refuse it anyway; this says so kindly.
 */
export function NoAccessScreen({ app }: { app: Exclude<AppId, "shop" | "ops"> }) {
  const { signOut, viewer, reloadRoles, rolesLoading, roles, rolesError } = useSession();
  // Roles that could not be read (no connection) are not a "no": say what happened instead.
  const text =
    !roles && rolesError
      ? { title: "No pudimos revisar su acceso", body: `${rolesError} Su cuenta no cambió.` }
      : NO_ACCESS[app];
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
          <Button variant="ghost" block onPress={() => void signOut()}>
            Salir e ingresar con otra cuenta
          </Button>
        </Stack>
      </View>
    </Screen>
  );
}
