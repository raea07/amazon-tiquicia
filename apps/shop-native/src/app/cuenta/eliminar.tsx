import { accountDeletedNotice, DeleteAccountScreenBody } from "@yuntera/expo-kit/account";
import { useSession } from "@yuntera/expo-kit/auth";
import { signInPath } from "@yuntera/expo-kit/paths";
import { Screen } from "@yuntera/expo-kit/ui";
import { Redirect, router } from "expo-router";
import { useCart } from "@/lib/cart-context";

/**
 * Eliminar su cuenta (the website's /cuenta/eliminar). Besides the session,
 * this phone keeps the cart and the chosen delivery district; both go too.
 * Afterwards the shop's home says the account was deleted.
 */
export default function DeleteAccount() {
  const { status } = useSession();
  const cart = useCart();
  if (status === "signedOut") {
    return accountDeletedNotice.current() ? (
      <Redirect href="/" />
    ) : (
      <Redirect href={signInPath("/cuenta/eliminar")} />
    );
  }
  return (
    <Screen>
      <DeleteAccountScreenBody
        forgetDevice={cart.forget}
        onCancel={() => (router.canGoBack() ? router.back() : router.replace("/cuenta"))}
      />
    </Screen>
  );
}
