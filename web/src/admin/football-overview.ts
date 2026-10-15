import {
  SERIE_A_EXPECTED_CURRENT_CLUBS, SERIE_A_EXPECTED_CURRENT_MATCHES,
  SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS,
} from "../football/foundation";
import { OVERVIEW_DATASETS, type FootballOverviewData, type OverviewDatasetId } from "./football-overview-repository";
import type { JobExecutionStatus } from "../jobs/types";

export const OVERVIEW_STATUS_LABELS: Record<JobExecutionStatus, string> = {
  pending: "Ожидает", running: "Выполняется", succeeded: "Успешно", failed: "Ошибка",
};

export function overviewTime(value: Date | string | null): string {
  if (value === null) return "Нет сведений";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short", timeStyle: "medium", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

export function buildFootballOverview(data: FootballOverviewData) {
  const facts = data.facts;
  const finished = data.finishedMatches.length;
  const complete = (field: "eventsComplete" | "lineupsComplete" | "statisticsComplete") =>
    data.finishedMatches.filter((match) => match[field]).length;
  const coverage = (count: number) => finished === 0
    ? "Завершённых матчей пока нет; полнота не оценивается."
    : `${count} из ${finished} завершённых матчей. Для остальных полнота не подтверждена.`;
  const fullCount = (count: number, expected: number) => count === expected
    ? `${count} из ${expected}; ожидаемый объём сохранён.`
    : `${count} из ${expected}; ожидаемый объём не подтверждён.`;
  const descriptions: Record<OverviewDatasetId, { presence: string; completeness: string; gap: boolean }> = {
    foundation: {
      presence: `Сезонов: ${facts.season_count}; клубов: ${facts.clubs}.`,
      completeness: fullCount(facts.clubs, SERIE_A_EXPECTED_CURRENT_CLUBS),
      gap: facts.season_count !== 1 || facts.clubs !== SERIE_A_EXPECTED_CURRENT_CLUBS,
    },
    matches: {
      presence: `Матчей: ${facts.matches}.`,
      completeness: fullCount(facts.matches, SERIE_A_EXPECTED_CURRENT_MATCHES),
      gap: facts.matches !== SERIE_A_EXPECTED_CURRENT_MATCHES,
    },
    standings: {
      presence: `Строк: ${facts.standings}.`,
      completeness: fullCount(facts.standings, SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS),
      gap: facts.standings !== SERIE_A_EXPECTED_CURRENT_STANDINGS_ROWS,
    },
    squads: {
      presence: `Игроков: ${facts.squad_players}; записей в составах: ${facts.squad_memberships}.`,
      completeness: `Клубов с составом: ${facts.squad_clubs} из ${SERIE_A_EXPECTED_CURRENT_CLUBS}. Ожидаемое число игроков неизвестно.`,
      gap: facts.squad_clubs !== SERIE_A_EXPECTED_CURRENT_CLUBS,
    },
    "player-statistics": {
      presence: `Игроков: ${facts.statistics_players}; записей игрок–клуб: ${facts.player_statistics}.`,
      completeness: "Ожидаемое число записей неизвестно; количество строк не доказывает полноту импорта.",
      gap: false,
    },
    events: {
      presence: `Событий: ${facts.events}. Нулевой снимок может быть корректным.`,
      completeness: coverage(complete("eventsComplete")),
      gap: complete("eventsComplete") < finished,
    },
    lineups: {
      presence: `Снимков команд: ${facts.lineups}.`,
      completeness: coverage(complete("lineupsComplete")) + " Требуются обе команды.",
      gap: complete("lineupsComplete") < finished,
    },
    statistics: {
      presence: `Снимков команд: ${facts.statistics}.`,
      completeness: coverage(complete("statisticsComplete")) + " Требуются обе команды и scope full_match.",
      gap: complete("statisticsComplete") < finished,
    },
  };

  const datasets = OVERVIEW_DATASETS.map((dataset) => {
    const job = data.jobs.find((job) => job.type === dataset.jobType);
    const issues: string[] = [];
    if (descriptions[dataset.id].gap) issues.push("Неполное покрытие данных");
    if (dataset.id === "player-statistics" && facts.player_statistics === 0) issues.push("Нет сохранённых записей статистики игроков; причина не установлена");
    if (job?.failed_scopes) issues.push(`Областей синхронизации с ошибкой последнего запуска: ${job.failed_scopes}`);
    if (job?.expired) issues.push(`Запусков с истёкшим сроком аренды: ${job.expired}`);
    return { ...dataset, ...descriptions[dataset.id], job, issues, observation: facts.observations[dataset.id] };
  });
  return { datasets, attention: datasets.filter((dataset) => dataset.issues.length > 0) };
}
