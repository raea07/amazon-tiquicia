import { DeleteAccountPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Eliminar su cuenta", robots: { index: false } };

export default function Page() {
  return <DeleteAccountPage />;
}
