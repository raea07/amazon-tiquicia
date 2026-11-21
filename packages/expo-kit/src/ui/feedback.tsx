import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { messageOf } from "../errors";
import { colors, radius, space, type Tone, tone } from "../theme/tokens";
import { Button } from "./button";
import { Text } from "./text";

/**
 * A message in a box. Errors interrupt (announced at once); everything else
 * is announced politely. Status is never colour alone: there is always text.
 */
export function Alert({
  tone: kind = "info",
  title,
  children,
  testID,
}: {
  tone?: Exclude<Tone, "neutral" | "promo">;
  title?: string;
  children?: ReactNode;
  testID?: string;
}) {
  const pair = tone[kind];
  return (
    <View
      role={kind === "danger" ? "alert" : "status"}
      aria-live={kind === "danger" ? "assertive" : "polite"}
      testID={testID}
      style={[styles.alert, { backgroundColor: pair.bg, borderColor: pair.border }]}
    >
      {title ? (
        <Text variant="bodyStrong" style={{ color: pair.fg }}>
          {title}
        </Text>
      ) : null}
      {typeof children === "string" ? (
        <Text variant="small" style={{ color: pair.fg }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

/** The outcome of the last thing the person sent: what the web's FormMessage shows. */
export function FormMessage({
  error,
  ok,
  testID,
}: {
  error?: string | null;
  ok?: string | null;
  testID?: string;
}) {
  if (error)
    return (
      <Alert tone="danger" testID={testID}>
        {error}
      </Alert>
    );
  if (ok)
    return (
      <Alert tone="success" testID={testID}>
        {ok}
      </Alert>
    );
  return null;
}

export function Badge({ tone: kind = "neutral", children }: { tone?: Tone; children: string }) {
  const pair = tone[kind];
  return (
    <View style={[styles.badge, { backgroundColor: pair.bg }]}>
      <Text variant="caption" style={{ color: pair.fg, fontWeight: "600" }} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

export function LoadingState({ label = "Cargando…" }: { label?: string }) {
  return (
    <View style={styles.centre} aria-busy role="progressbar" aria-label={label}>
      <ActivityIndicator color={colors.brand} size="large" />
      <Text tint="muted">{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.centre}>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {typeof children === "string" ? (
        <Text tint="muted" align="center">
          {children}
        </Text>
      ) : (
        children
      )}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

/** Something could not be loaded: say so plainly and offer to try again. */
export function ErrorState({
  error,
  onRetry,
  title = "No pudimos cargar esta información",
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <EmptyState
      title={title}
      action={
        <Button variant="secondary" onPress={onRetry}>
          Intentar de nuevo
        </Button>
      }
    >
      {messageOf(error)}
    </EmptyState>
  );
}

const styles = StyleSheet.create({
  alert: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[1],
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  centre: {
    alignItems: "center",
    justifyContent: "center",
    gap: space[3],
    paddingHorizontal: space[6],
    paddingVertical: space[10],
  },
  action: { marginTop: space[2] },
});
