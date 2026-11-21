import { colors } from "@yuntera/expo-kit/theme";
import { Stack } from "expo-router";

/** The screens of the app proper, shown only to an account with the right role. */
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
  );
}
