import { NewPasswordPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contraseña nueva", robots: { index: false } };

export default function Page() {
  return <NewPasswordPage home="/" />;
}
