import { VerifyPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";
import { signOut } from "@/app/actions";

export const metadata: Metadata = { title: "Verificación en dos pasos", robots: { index: false } };

export default function Page({ searchParams }: PageProps<"/verificar">) {
  return <VerifyPage searchParams={searchParams} signOut={signOut} />;
}
