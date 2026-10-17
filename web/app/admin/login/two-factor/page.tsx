import { redirect } from "next/navigation";
import { Container } from "@/components/layout/container";
import { StaffAuthForm } from "@/components/admin/staff-auth-form";
import { getStaffSession } from "@/src/auth/session";
import { resolveAdminReturnPath } from "@/src/identity/admin-return";
export default async function TwoFactorPage({ searchParams }: PageProps<"/admin/login/two-factor">) {
  const returnTo = resolveAdminReturnPath((await searchParams).returnTo);
  const session = await getStaffSession();
  if (session?.fullAccess) redirect(returnTo);
  return <main className="min-h-dvh py-10"><Container size="narrow"><h1 className="mb-6 text-2xl font-semibold">Двухфакторная проверка</h1><StaffAuthForm mode={session ? "enroll" : "challenge"} returnTo={returnTo} /></Container></main>;
}
