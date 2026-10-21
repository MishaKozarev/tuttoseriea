import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import { AdminShell } from "@/components/layout/admin-shell";
import { Container } from "@/components/layout/container";
import { getFootballAdminAccess } from "@/src/identity/football-admin-access";
import { loadFootballOverview } from "@/src/admin/football-overview-repository";
import { buildFootballOverview, overviewTime, OVERVIEW_STATUS_LABELS } from "@/src/admin/football-overview";
import { SERIE_A_CURRENT_SEASON_LABEL } from "@/src/football/foundation";
import { logger } from "@/src/logging/logger";

export default async function FootballAdminPage() {
  const decision = await getFootballAdminAccess("/admin/football");

  if (decision.type === "redirect") {
    redirect(decision.location);
  }

  if (decision.type === "forbidden") {
    forbidden();
  }

  const data = await loadFootballOverview().catch((error: unknown) => {
    logger.error("Football Admin overview read failed", { context: { error } });
    return null;
  });
  const overview = data === null ? null : buildFootballOverview(data);

  return (
    <AdminShell>
      <section className="py-10">
        <Container size="wide" className="space-y-8">
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold text-foreground">
              Управление футболом
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Административный раздел футбольных данных tuttoseriea.com.
            </p>
            <Link
              href="/admin"
              className="text-sm font-medium underline underline-offset-4"
            >
              Назад к администрированию
            </Link>
          </div>
          <nav aria-label="Разделы Football Admin" className="flex flex-wrap gap-4">
            <Link href="/admin/football/synchronization" className="text-sm font-medium underline underline-offset-4">Синхронизация</Link>
            <Link href="/admin/football/localization" className="text-sm font-medium underline underline-offset-4">Локализация</Link>
            <Link href="/admin/football/data" className="text-sm font-medium underline underline-offset-4">Football данные</Link>
          <Link href="/admin/football/coaches" className="text-sm font-medium underline underline-offset-4">Тренеры</Link>
          <Link href="/admin/football/tags" className="text-sm font-medium underline underline-offset-4">Football Tags</Link>
      </nav>
          <section aria-labelledby="overview-heading" className="space-y-4">
            <h2 id="overview-heading" className="text-xl font-semibold">Обзор</h2>
            <p className="text-sm text-muted-foreground">
              Серия A · {SERIE_A_CURRENT_SEASON_LABEL}. Состояние сохранённых данных PostgreSQL.
            </p>
            {data === null || overview === null ? (
              <p role="alert" className="rounded-lg border p-4">
                Не удалось получить обзор. Обновите страницу позднее. Состояние данных и синхронизации неизвестно.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Срез: {overviewTime(data.checkedAt)}.</p>
                <section aria-labelledby="attention-heading" className="space-y-2 rounded-lg border p-4">
                  <h3 id="attention-heading" className="font-semibold">Требует внимания</h3>
                  {overview.attention.length === 0 ? (
                    <p className="text-sm">Проблем по проверяемым признакам не обнаружено. Свежесть и работа consumer этим не подтверждены.</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {overview.attention.map((dataset) => (
                        <li key={dataset.id}><a className="underline underline-offset-4" href={`#dataset-${dataset.id}`}>{dataset.label}</a>: {dataset.issues.join("; ")}.</li>
                      ))}
                    </ul>
                  )}
                </section>
                <section aria-labelledby="datasets-heading" className="space-y-3">
                  <h3 id="datasets-heading" className="font-semibold">Наборы данных</h3>
                  <p className="text-sm text-muted-foreground">
                    Наличие, полнота и синхронизация оцениваются отдельно. Время наблюдения отражает сохранённые строки,
                    а не сравнение с провайдером; свежесть всего dataset не подтверждается последним запуском одного матча.
                    Полнота матчевых datasets проверяется только для завершённых матчей. Предстоящие и активные матчи в этот знаменатель не входят.
                  </p>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {overview.datasets.map((dataset) => (
                      <article key={dataset.id} id={`dataset-${dataset.id}`} className="space-y-3 rounded-lg border p-4">
                        <h4 className="font-semibold">{dataset.label}</h4>
                        <dl className="space-y-2 text-sm">
                          <div><dt className="font-medium">Наличие</dt><dd>{dataset.presence}</dd></div>
                          <div><dt className="font-medium">Полнота</dt><dd>{dataset.completeness}</dd></div>
                          <div><dt className="font-medium">Свежесть</dt><dd>
                            {dataset.observation.oldest === null ? "Время наблюдения строк неизвестно." : <>
                              Наблюдения сохранённых строк: от {overviewTime(dataset.observation.oldest)} до {overviewTime(dataset.observation.newest)}.
                            </>} Актуальность относительно провайдера неизвестна.
                          </dd></div>
                          <div><dt className="font-medium">Синхронизация</dt><dd>
                            {dataset.job ? <>
                              Ожидают: {dataset.job.pending}; из них повторные попытки: {dataset.job.retries}; выполняются: {dataset.job.running}.
                              {" "}Последний успешный запуск{dataset.key === null ? " (любой матч)" : ""}: {overviewTime(dataset.job.last_success_at)}.
                            </> : "Запуски не зарегистрированы."}
                          </dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </section>
                <section aria-labelledby="executions-heading" className="space-y-3">
                  <h3 id="executions-heading" className="font-semibold">Последние запуски Football jobs</h3>
                  <p className="text-sm text-muted-foreground">
                    До 20 последних executions текущего сезона из всех способов запуска. Ошибка запуска не удаляет ранее сохранённые данные.
                    Pending и время доступности не гарантируют исполнение: этот обзор не проверяет работу consumer или dispatcher.
                  </p>
                  {data.recentExecutions.length === 0 ? <p className="text-sm">История запусков пуста.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-sm">
                        <caption className="sr-only">Последние 20 запусков Football jobs</caption>
                        <thead><tr>{["Dataset / execution ID", "Scope / Admin request", "Статус", "Попытки", "Время UTC", "Код ошибки"].map((label) => <th key={label} className="border-b p-2 font-medium">{label}</th>)}</tr></thead>
                        <tbody>{data.recentExecutions.map((execution) => (
                          <tr key={execution.id}>
                            <td className="border-b p-2"><p>{overview.datasets.find((dataset) => dataset.jobType === execution.type)?.label}</p><code className="break-all text-xs">{execution.id}</code></td>
                            <td className="border-b p-2"><p className="break-all">{execution.match_id === null ? "Весь сезон" : `Матч ${execution.match_id}`}</p><p>{execution.admin_requested ? "Есть Admin request" : "Нет Admin request"}</p></td>
                            <td className="border-b p-2">{OVERVIEW_STATUS_LABELS[execution.status]}</td>
                            <td className="border-b p-2">{execution.attempt_count} / {execution.max_attempts}</td>
                            <td className="border-b p-2"><p>Создан: {overviewTime(execution.created_at)}</p>
                              {execution.finished_at !== null && <p>Завершён: {overviewTime(execution.finished_at)}</p>}
                              {execution.status === "pending" && <p>Доступен с: {overviewTime(execution.available_at)}</p>}
                            </td>
                            <td className="border-b p-2"><code>{execution.last_error_code ?? "—"}</code></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </Container>
      </section>
    </AdminShell>
  );
}
