import { DeleteAccountScreen } from "@yuntera/expo-kit/account";
import { forgetWarehouse } from "@/lib/warehouse";

/**
 * Eliminar su cuenta (the field app's /cuenta/eliminar), from Su cuenta or
 * from the screen for an account this app is not for. An account assigned
 * to a warehouse waits until operations removes the assignment (the screen
 * says so). Besides the session, this phone remembers the warehouse chosen;
 * that goes too.
 */
export default function DeleteAccount() {
  return <DeleteAccountScreen forgetDevice={async () => forgetWarehouse()} />;
}
