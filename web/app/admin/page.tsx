import { forbidden, redirect } from "next/navigation";
import Link from "next/link";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { decideAdminAccess } from "@/src/identity/admin-access";
import { getCurrentIdentityAccess } from "@/src/identity/session";
import { StaffSessionControls } from "@/components/admin/staff-session-controls";
import { CatalogNavigation } from "@/components/admin/catalog-navigation";

export default async function AdminPage() {
  const current = await getCurrentIdentityAccess();
  const decision = decideAdminAccess(current, "/admin");

  if (decision.type === "redirect") {
    redirect(decision.location);
  }

  if (decision.type === "forbidden") {
    forbidden();
  }

  return (
    <AdminShell>
      <section className="py-10">
        <Container size="wide">
          <div className="space-y-3">
            <StaffSessionControls superAdmin={current.identityAccess?.roles.includes("super_admin")} />
            {current.identityAccess?.roles.includes("super_admin") && <CatalogNavigation />}
            {current.identityAccess?.roles.includes("writer") && <Link href="/admin/profile" className="block underline">Кабинет автора</Link>}
            <p className="text-sm font-medium text-muted-foreground">
              Личный кабинет
            </p>
            <h1 className="text-2xl font-semibold text-foreground">
              Администрирование
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Доступные разделы зависят от назначенных вам прав.
            </p>
          </div>
        </Container>
      </section>
    </AdminShell>
  );
}
