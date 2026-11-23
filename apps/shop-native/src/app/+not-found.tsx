import { EmptyState, LinkButton } from "@yuntera/expo-kit/ui";
import { Stack } from "expo-router";
import { NOT_FOUND } from "@/lib/wording";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "No encontrado" }} />
      <EmptyState
        title={NOT_FOUND.title}
        action={<LinkButton href="/">{NOT_FOUND.action}</LinkButton>}
      >
        {NOT_FOUND.body}
      </EmptyState>
    </>
  );
}
