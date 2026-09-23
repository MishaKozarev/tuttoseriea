import { forbidden, redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { decideAdminAccess } from "@/src/identity/admin-access";
import { getCurrentIdentityAccess } from "@/src/identity/session";

export default async function AdminPage() {
  const decision = decideAdminAccess(await getCurrentIdentityAccess(), "/admin");

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
            <p className="text-sm font-medium text-muted-foreground">
              Stage 3.4
            </p>
            <h1 className="text-2xl font-semibold text-foreground">
              Admin foundation
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Минимальная защищённая оболочка для будущих редакционных и
              административных разделов.
            </p>
          </div>
        </Container>
      </section>
    </AdminShell>
  );
}
