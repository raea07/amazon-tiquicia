import { SignInScreen } from "@yuntera/expo-kit/auth";
import { shopUrl } from "@/lib/env";

export default function SignIn() {
  return <SignInScreen app="driver" website={shopUrl} />;
}
