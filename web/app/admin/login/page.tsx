import { redirect } from "next/navigation";
import { Container } from "@/components/layout/container";
import { StaffAuthForm } from "@/components/admin/staff-auth-form";
import { getStaffSession } from "@/src/auth/session";
import { resolveAdminReturnPath } from "@/src/identity/admin-return";
export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const returnTo = resolveAdminReturnPath((await searchParams).returnTo);
  const session = await getStaffSession();
  if (session) redirect(session.fullAccess ? returnTo : `/admin/login/two-factor?${new URLSearchParams({ returnTo })}`);
  return <main className="min-h-dvh py-10"><Container size="narrow"><h1 className="mb-6 text-2xl font-semibold">Вход для staff</h1><StaffAuthForm mode="login" returnTo={returnTo} /></Container></main>;
}
