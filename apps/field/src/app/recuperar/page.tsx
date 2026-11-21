import { RecoveryPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";
import { Frame } from "@/components/frame";

export const metadata: Metadata = { title: "Restablecer su contraseña", robots: { index: false } };

export default function Page() {
  return (
    <Frame app="driver">
      <RecoveryPage />
    </Frame>
  );
}
