import { ConfirmLinkPage } from "@yuntera/next-kit/account";
import type { Metadata } from "next";
import { Frame } from "@/components/frame";

export const metadata: Metadata = { title: "Confirmar", robots: { index: false } };

// Where the links in Yuntera's e-mails land; see ConfirmLinkPage.
export default function Page({ searchParams }: PageProps<"/auth/confirm">) {
  return (
    <Frame app="driver">
      <ConfirmLinkPage searchParams={searchParams} />
    </Frame>
  );
}
