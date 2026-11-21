import { AccountSecuritySection } from "@yuntera/next-kit/account";
import { requireViewer } from "@yuntera/next-kit/server";
import { buttonClass, Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Frame } from "@/components/frame";

export const metadata: Metadata = { title: "Su cuenta" };

export default function AccountPage() {
  return (
    <Frame app="driver">
      <div className="shell max-w-2xl py-8">
        <h1 className="text-3xl font-bold">Su cuenta</h1>
        <div className="mt-6">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Account />
          </Suspense>
        </div>
        <Link href="/" className={buttonClass({ variant: "secondary", className: "mt-6" })}>
          Volver
        </Link>
      </div>
    </Frame>
  );
}

async function Account() {
  const viewer = await requireViewer("/cuenta");
  return (
    <>
      <p className="mb-4 text-sm text-ink-muted">{viewer.email}</p>
      <AccountSecuritySection />
    </>
  );
}
