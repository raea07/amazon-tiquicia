import { RecoveryPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Restablecer su contraseña", robots: { index: false } };

export default function Page() {
  return <RecoveryPage />;
}
