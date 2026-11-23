import { messageOf } from "@yuntera/expo-kit/api";
import { tone } from "@yuntera/expo-kit/theme";
import { Alert, Button, Stack, Text } from "@yuntera/expo-kit/ui";
import { TRY_AGAIN } from "@/lib/kept-reads";

/**
 * Above what a screen kept when a read failed: what could not be read, why
 * (the error state's words, never a code), and "Intentar de nuevo". A
 * warning, announced politely; the screen below stays as it was.
 */
export function KeptNotice({
  title,
  body,
  error,
  onRetry,
  retrying = false,
  testID = "kept-notice",
}: {
  title: string;
  body: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  testID?: string;
}) {
  return (
    <Alert tone="warning" title={title} testID={testID}>
      <Stack gap={2}>
        <Text variant="small" style={{ color: tone.warning.fg }}>
          {`${body} ${messageOf(error)}`}
        </Text>
        <Button
          variant="secondary"
          onPress={onRetry}
          loading={retrying}
          loadingLabel="Consultando…"
          testID={`${testID}-retry`}
        >
          {TRY_AGAIN}
        </Button>
      </Stack>
    </Alert>
  );
}
