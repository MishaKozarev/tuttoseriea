import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { FootballLocalization } from "@/components/admin/football-localization";
import { getFootballAdminAccess } from "@/src/identity/football-admin-access";
import { FootballLocalizationError, parseLocalizationPageParams } from "@/src/football/localization-management";

export default async function FootballLocalizationPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const decision = await getFootballAdminAccess("/admin/football/localization");
  if (decision.type === "redirect") redirect(decision.location);
  if (decision.type === "forbidden") forbidden();
  let input: ReturnType<typeof parseLocalizationPageParams> | null = null;
  try { input = parseLocalizationPageParams(await searchParams ?? {}); }
  catch (error) { if (!(error instanceof FootballLocalizationError)) throw error; }
  return <AdminShell>
    <section className="py-10"><Container size="wide" className="space-y-6">
      <h1 className="text-2xl font-semibold">Локализация</h1>
      <nav aria-label="Разделы Football Admin" className="flex flex-wrap gap-4 text-sm font-medium underline underline-offset-4">
        <Link href="/admin/football">Обзор футбольных данных</Link><Link href="/admin/football/synchronization">Синхронизация</Link>
        <Link href="/admin/football/data">Football данные</Link>
        <Link href="/admin/football/coaches" className="text-sm font-medium underline underline-offset-4">Тренеры</Link>
      </nav>
      {input ? <FootballLocalization key={`${decision.identityAccess.accountId}:${input.filter.kind}:${input.initialId ?? ""}`} {...input} />
        : <p role="alert">Некорректные параметры локализации.</p>}
    </Container></section>
  </AdminShell>;
}
