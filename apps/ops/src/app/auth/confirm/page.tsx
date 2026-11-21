import { ConfirmLinkPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Confirmar", robots: { index: false } };

// Where the links in Yuntera's e-mails land; see ConfirmLinkPage.
export default function Page({ searchParams }: PageProps<"/auth/confirm">) {
  return <ConfirmLinkPage searchParams={searchParams} />;
}
