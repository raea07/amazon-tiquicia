import { SecondFactorPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";
import { signOut } from "@/app/actions";

export const metadata: Metadata = { title: "Verificación en dos pasos", robots: { index: false } };

export default function Page({ searchParams }: PageProps<"/dos-pasos">) {
  return <SecondFactorPage searchParams={searchParams} signOut={signOut} />;
}
