import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";

export default function FootballAdminForbidden() {
  return (
    <AdminShell>
      <section className="py-10">
        <Container size="wide">
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">403</p>
            <h1 className="text-2xl font-semibold text-foreground">
              Доступ запрещён
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              У вашего аккаунта нет доступа к управлению футбольными данными.
            </p>
          </div>
        </Container>
      </section>
    </AdminShell>
  );
}
