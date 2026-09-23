import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requestStaffMagicLink } from "@/app/admin/login/actions";
import { Container } from "@/components/layout/container";
import { resolveAdminReturnPath } from "@/src/identity/admin-return";
import { getCurrentIdentityAccess } from "@/src/identity/session";
import { PERMISSION_IDS, hasPermissionForRoles } from "@/src/identity/rbac";

export default async function AdminLoginPage({
  searchParams,
}: PageProps<"/admin/login">) {
  const params = await searchParams;
  const returnTo = resolveAdminReturnPath(params.returnTo);
  const currentIdentityAccess = await getCurrentIdentityAccess();

  if (
    currentIdentityAccess.authenticated &&
    currentIdentityAccess.identityAccess &&
    hasPermissionForRoles(
      currentIdentityAccess.identityAccess.roles,
      PERMISSION_IDS.adminAccess,
    )
  ) {
    redirect(returnTo);
  }

  return (
    <main className="flex min-h-dvh items-center bg-background py-10">
      <Container size="narrow">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              tuttoseriea.com
            </p>
            <h1 className="text-2xl font-semibold text-foreground">
              Вход для staff
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Доступ открыт только заранее provisioned аккаунтам с permission
              `admin.access`.
            </p>
          </div>
          <form action={requestStaffMagicLink} className="space-y-4">
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Email</span>
              <input
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            {params.error ? (
              <p className="text-sm text-destructive">
                Проверьте email и попробуйте ещё раз.
              </p>
            ) : null}
            <Button type="submit">Получить ссылку</Button>
          </form>
        </div>
      </Container>
    </main>
  );
}
