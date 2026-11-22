import { DeleteAccountScreen } from "@yuntera/expo-kit/account";
import { useDriver } from "@/lib/driver";

/**
 * Eliminar su cuenta (the field app's /cuenta/eliminar), from Su cuenta or
 * from the screen for an account this app is not for. A driver's account
 * waits until operations has offboarded it (the screen says so). Besides the
 * session, this phone keeps the day's route and the actions waiting to be
 * sent; both go too, and position sharing stops.
 */
export default function DeleteAccount() {
  const { forgetAccount } = useDriver();
  return <DeleteAccountScreen forgetDevice={forgetAccount} />;
}
