import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { FootballCoaches } from "@/components/admin/football-coaches";
import { getFootballAdminAccess } from "@/src/identity/football-admin-access";
import { FootballCoachesInputError, parseFootballCoachesQuery, type FootballCoachesQuery } from "@/src/admin/football-coaches";
import { loadFootballCoaches, type FootballCoachesModel } from "@/src/admin/football-coaches-repository";
import { FootballLocalizationError } from "@/src/football/localization-management";
import { logger } from "@/src/logging/logger";

export default async function FootballCoachesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const decision = await getFootballAdminAccess("/admin/football/coaches");
  if (decision.type === "redirect") redirect(decision.location);
  if (decision.type === "forbidden") forbidden();
  let result: { filter: FootballCoachesQuery; data: FootballCoachesModel } | null = null;
  let problem = "";
  try {
    const filter = parseFootballCoachesQuery(await searchParams);
    result = { filter, data: await loadFootballCoaches(filter) };
  } catch (error) {
    if (error instanceof FootballCoachesInputError || error instanceof FootballLocalizationError) problem = "Некорректные параметры поиска тренеров.";
    else { logger.error("Football Admin Coaches read failed", { context: { error } }); problem = "Не удалось прочитать данные тренеров. Их состояние неизвестно. Повторите чтение позже."; }
  }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">Тренеры</h1>
    <nav aria-label="Разделы Football Admin" className="flex flex-wrap gap-4 text-sm font-medium underline underline-offset-4">
      <Link href="/admin/football">Обзор</Link><Link href="/admin/football/synchronization">Синхронизация</Link>
      <Link href="/admin/football/localization">Локализация</Link><Link href="/admin/football/data">Football данные</Link>
    </nav>
    {result ? <FootballCoaches data={result.data} filter={result.filter} /> : <p role="alert">{problem}</p>}
  </Container></section></AdminShell>;
}
