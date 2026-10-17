import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { StaffAuthForm } from "@/components/admin/staff-auth-form";
import { getStaffSession } from "@/src/auth/session";
export default async function SecurityPage() {
  const session = await getStaffSession();
  if (!session) redirect("/admin/login");
  if (!session.fullAccess || !session.user.roles.includes("super_admin")) forbidden();
  return <AdminShell><h1 className="mb-6 text-2xl font-semibold">Смена пароля Super Admin</h1><StaffAuthForm mode="password" /></AdminShell>;
}
