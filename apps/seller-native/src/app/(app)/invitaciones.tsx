import { Screen, Text } from "@yuntera/expo-kit/ui";
import { MyInvitations } from "@/components/invitations";

/** Invitaciones (the seller centre's /invitaciones): shops that invited this account. */
export default function InvitationsScreen() {
  return (
    <Screen>
      <Text tint="muted">
        Tiendas que le invitaron a trabajar en su equipo. Usted decide si se une.
      </Text>
      <MyInvitations />
    </Screen>
  );
}
