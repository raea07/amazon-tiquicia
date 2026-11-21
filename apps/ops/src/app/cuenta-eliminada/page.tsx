import { AccountDeletedPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cuenta eliminada", robots: { index: false } };

export default function Page() {
  return <AccountDeletedPage />;
}
