import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { FootballSynchronization } from "@/components/admin/football-synchronization";
import { getFootballAdminAccess } from "@/src/identity/football-admin-access";

export default async function FootballSynchronizationPage() {
  const decision = await getFootballAdminAccess("/admin/football/synchronization");
  if (decision.type === "redirect") redirect(decision.location);
  if (decision.type === "forbidden") forbidden();

  return (
    <AdminShell>
      <section className="py-10">
        <Container size="wide" className="space-y-6">
          <h1 className="text-2xl font-semibold">Синхронизация</h1>
          <nav aria-label="Разделы Football Admin" className="flex flex-wrap gap-4 text-sm font-medium underline underline-offset-4">
            <Link href="/admin/football">Обзор футбольных данных</Link>
            <Link href="/admin/football/localization">Локализация</Link>
            <Link href="/admin/football/data">Football данные</Link>
    <Link href="/admin/football/coaches" className="text-sm font-medium underline underline-offset-4">Тренеры</Link>
      </nav>
          <FootballSynchronization key={decision.identityAccess.accountId} actorAccountId={decision.identityAccess.accountId} />
        </Container>
      </section>
    </AdminShell>
  );
}
