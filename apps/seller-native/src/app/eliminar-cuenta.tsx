import { DeleteAccountScreen } from "@yuntera/expo-kit/account";
import { useShops } from "@/lib/shops";

/**
 * Eliminar su cuenta (the seller centre's /cuenta/eliminar), from Cuenta or
 * from the screen for an account without a shop. Besides the session, this
 * phone remembers which shop the person works in; that goes too.
 */
export default function DeleteAccount() {
  const { forget } = useShops();
  return <DeleteAccountScreen forgetDevice={forget} />;
}
