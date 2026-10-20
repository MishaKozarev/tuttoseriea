import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { FootballData } from "@/components/admin/football-data";
import { getFootballAdminAccess } from "@/src/identity/football-admin-access";
import { parseFootballDataQuery, FootballDataInputError, type FootballDataQuery } from "@/src/admin/football-data";
import { loadFootballData, type FootballDataModel } from "@/src/admin/football-data-repository";
import { logger } from "@/src/logging/logger";

export default async function FootballDataPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const decision = await getFootballAdminAccess("/admin/football/data");
  if (decision.type === "redirect") redirect(decision.location);
  if (decision.type === "forbidden") forbidden();
  let result: { filter: FootballDataQuery; data: FootballDataModel } | null = null;
  let problem: string | null = null;
  try {
    const filter = parseFootballDataQuery(await searchParams);
    result = { filter, data: await loadFootballData(filter) };
  } catch (error) {
    if (error instanceof FootballDataInputError) problem = "Некорректные параметры поиска. Проверьте тип данных, фильтры, страницу и внутренний Match UUID.";
    else {
      logger.error("Football Admin Data read failed", { context: { error } });
      problem = "Не удалось прочитать Football данные. Их состояние неизвестно. Повторите чтение позже.";
    }
  }
  return <AdminShell><section className="py-10"><Container size="wide" className="space-y-6">
    <h1 className="text-2xl font-semibold">Football данные</h1>
    <nav aria-label="Разделы Football Admin" className="flex flex-wrap gap-4 text-sm font-medium underline underline-offset-4">
      <Link href="/admin/football">Обзор</Link><Link href="/admin/football/synchronization">Синхронизация</Link><Link href="/admin/football/localization">Локализация</Link>
    <Link href="/admin/football/coaches" className="text-sm font-medium underline underline-offset-4">Тренеры</Link>
      </nav>
    {result ? <FootballData data={result.data} filter={result.filter} actorAccountId={decision.identityAccess.accountId} /> : <p role="alert">{problem}</p>}
  </Container></section></AdminShell>;
}
