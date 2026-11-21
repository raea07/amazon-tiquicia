import { DeleteAccountPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";
import { Frame } from "@/components/frame";

export const metadata: Metadata = { title: "Eliminar su cuenta", robots: { index: false } };

export default function Page() {
  return (
    <Frame app="driver">
      <DeleteAccountPage />
    </Frame>
  );
}
