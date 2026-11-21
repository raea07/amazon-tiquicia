import { AccountSecuritySection } from "@yuntera/next-kit/account";
import { PageHeader } from "@yuntera/next-kit/shell";
import { Skeleton } from "@yuntera/ui";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/staff";

export const metadata: Metadata = { title: "Su cuenta" };

export default function AccountPage() {
  return (
    <div className="shell py-8">
      <PageHeader title="Su cuenta">Su contraseña y la verificación en dos pasos.</PageHeader>
      <div className="mt-6 max-w-2xl">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Account />
        </Suspense>
      </div>
    </div>
  );
}

async function Account() {
  await requireStaff("/cuenta");
  return <AccountSecuritySection secondFactor />;
}
