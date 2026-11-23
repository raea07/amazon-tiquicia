import { messageOf } from "@yuntera/expo-kit/api";
import { useApiMutation } from "@yuntera/expo-kit/data";
import { Button, Checkbox, FormMessage, Stack, Text } from "@yuntera/expo-kit/ui";
import { useState } from "react";
import {
  LOGO_WITHDRAWN,
  REMOVE_LOGO_CONFIRM,
  REMOVE_LOGO_CONFIRM_NEEDED,
  REMOVE_LOGO_LABEL,
  removedText,
  WITHDRAW_LOGO_LABEL,
} from "@/lib/logo-actions";
import { shopKey, useShop } from "@/lib/shops";

/**
 * Takes back the logo that waits for review (seller_withdraw_logo), as the
 * seller centre's `WithdrawLogoForm`. The confirmation is handed to the card,
 * because the shop's face is read again and this button goes with the logo.
 */
export function WithdrawLogoButton({ onDone }: { onDone: (message: string) => void }) {
  const shop = useShop();
  const [error, setError] = useState<string | null>(null);
  const withdraw = useApiMutation((api) => api.sellerWithdrawLogo(shop.id), {
    invalidates: [shopKey(shop.id, "front")],
  });
  return (
    <Stack gap={2}>
      <FormMessage error={error} testID="logo-withdraw-result" />
      <Button
        variant="secondary"
        loading={withdraw.isPending}
        loadingLabel="Retirando…"
        testID="logo-withdraw"
        onPress={async () => {
          setError(null);
          try {
            await withdraw.mutateAsync(undefined);
            onDone(LOGO_WITHDRAWN);
          } catch (cause) {
            setError(messageOf(cause));
          }
        }}
      >
        {WITHDRAW_LOGO_LABEL}
      </Button>
    </Stack>
  );
}

/**
 * Stops showing the current logo (seller_remove_logo): showing less needs no
 * review. The tick box makes it deliberate, as in the seller centre's
 * `RemoveLogoForm`.
 */
export function RemoveLogoForm({ onDone }: { onDone: (message: string) => void }) {
  const shop = useShop();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useApiMutation((api) => api.sellerRemoveLogo(shop.id), {
    invalidates: [shopKey(shop.id, "front")],
  });
  return (
    <Stack gap={2}>
      <Checkbox checked={confirmed} onChange={setConfirmed} testID="logo-remove-confirm">
        <Text variant="small">{REMOVE_LOGO_CONFIRM}</Text>
      </Checkbox>
      <FormMessage error={error} testID="logo-remove-result" />
      <Button
        variant="secondary"
        loading={remove.isPending}
        loadingLabel="Quitando…"
        testID="logo-remove"
        onPress={async () => {
          if (!confirmed) return setError(REMOVE_LOGO_CONFIRM_NEEDED);
          setError(null);
          try {
            onDone(removedText(await remove.mutateAsync(undefined)));
          } catch (cause) {
            setError(messageOf(cause));
          }
        }}
      >
        {REMOVE_LOGO_LABEL}
      </Button>
    </Stack>
  );
}
