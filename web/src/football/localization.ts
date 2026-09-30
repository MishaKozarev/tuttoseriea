import type { NormalizedFixtureState } from "./api-football/fixture-status";
import type { PlayerStatisticsValues } from "./player-statistics-repository";

export type FootballNameReviewStatus = "unreviewed" | "reviewed";

export type FootballProperName = {
  providerName: string;
  nameRu: string | null | undefined;
  reviewStatus: string | null | undefined;
};

export function resolveFootballProperName(name: FootballProperName): string {
  if (
    name.reviewStatus === "reviewed" &&
    typeof name.nameRu === "string" &&
    name.nameRu.trim().length > 0
  ) {
    return name.nameRu;
  }

  return name.providerName;
}

type GeographyIdentity =
  | { kind: "region"; regionCode: string }
  | { kind: "football"; key: "england" | "scotland" | "wales" };

const providerGeographyAliases = new Map<string, GeographyIdentity>([
  ["Italy", { kind: "region", regionCode: "IT" }],
  ["USA", { kind: "region", regionCode: "US" }],
  ["England", { kind: "football", key: "england" }],
  ["Scotland", { kind: "football", key: "scotland" }],
  ["Wales", { kind: "football", key: "wales" }],
]);

const footballGeographyLabelsRu = {
  england: "Англия",
  scotland: "Шотландия",
  wales: "Уэльс",
} satisfies Record<Extract<GeographyIdentity, { kind: "football" }>["key"], string>;

const regionLabelsRu = new Map([["US", "США"]]);

const russianRegionNames = new Intl.DisplayNames(["ru"], { type: "region" });

export function resolveFootballGeography(
  providerValue: string | null | undefined,
): string | null {
  if (providerValue == null) {
    return null;
  }

  const identity = providerGeographyAliases.get(providerValue);

  if (!identity) {
    return providerValue;
  }

  if (identity.kind === "football") {
    return footballGeographyLabelsRu[identity.key];
  }

  const displayName =
    regionLabelsRu.get(identity.regionCode) ?? russianRegionNames.of(identity.regionCode);

  return displayName && displayName !== identity.regionCode ? displayName : providerValue;
}

export const FIXTURE_STATUS_LABELS_RU = {
  scheduled: "Не начался",
  live: "Идёт матч",
  paused: "Перерыв",
  suspended: "Приостановлен",
  interrupted: "Прерван",
  postponed: "Перенесён",
  abandoned: "Прекращён",
  finished: "Завершён",
  cancelled: "Отменён",
  awarded: "Результат присуждён",
  walkover: "Техническая победа",
} satisfies Record<NormalizedFixtureState, string>;

export function resolveFixtureStatusLabel(
  status: string,
  providerFallback: string,
): string {
  return Object.hasOwn(FIXTURE_STATUS_LABELS_RU, status)
    ? FIXTURE_STATUS_LABELS_RU[status as NormalizedFixtureState]
    : providerFallback;
}

const playerPositionLabelsRu = {
  Goalkeeper: "Вратарь",
  Defender: "Защитник",
  Midfielder: "Полузащитник",
  Attacker: "Нападающий",
} as const;

export function resolvePlayerPosition(position: string): string {
  const normalized = position.trim();

  return Object.hasOwn(playerPositionLabelsRu, normalized)
    ? playerPositionLabelsRu[normalized as keyof typeof playerPositionLabelsRu]
    : position;
}

export const PLAYER_STATISTICS_LABELS_RU = {
  appearances: "Матчи",
  lineups: "В стартовом составе",
  minutes: "Минуты",
  shirtNumber: "Номер",
  position: "Позиция",
  rating: "Рейтинг",
  captain: "Капитан",
  substitutesIn: "Выходы на замену",
  substitutesOut: "Замены",
  substitutesBench: "На скамейке",
  shotsTotal: "Удары",
  shotsOn: "Удары в створ",
  goalsTotal: "Голы",
  goalsConceded: "Пропущенные голы",
  goalsAssists: "Голевые передачи",
  passesTotal: "Передачи",
  passesKey: "Ключевые передачи",
  passesAccuracy: "Точность передач",
  tacklesTotal: "Отборы",
  tacklesBlocks: "Блокированные удары",
  tacklesInterceptions: "Перехваты",
  duelsTotal: "Единоборства",
  duelsWon: "Выигранные единоборства",
  dribblesAttempts: "Попытки дриблинга",
  dribblesSuccess: "Успешный дриблинг",
  foulsDrawn: "Заработанные фолы",
  foulsCommitted: "Нарушения",
  cardsYellow: "Жёлтые карточки",
  cardsYellowRed: "Вторые жёлтые карточки",
  cardsRed: "Красные карточки",
  penaltyCommitted: "Нарушения с пенальти",
  penaltyScored: "Забитые пенальти",
  penaltyMissed: "Незабитые пенальти",
} satisfies Record<keyof PlayerStatisticsValues, string>;

export function resolvePlayerStatisticsLabel(
  field: keyof PlayerStatisticsValues,
): string {
  return PLAYER_STATISTICS_LABELS_RU[field];
}

export function formatMatchRound(providerRound: string): string {
  const match = /^Regular Season - ([1-9]\d*)$/u.exec(providerRound);

  return match ? `${match[1]}-й тур` : providerRound;
}

const standingsDescriptionLabelsRu = new Map([
  ["Champions League", "Лига чемпионов"],
  ["Champions League league stage", "Лига чемпионов"],
  ["Europa League", "Лига Европы"],
]);

export function resolveStandingsDescription(
  providerDescription: string | null,
): string | null {
  if (providerDescription == null) {
    return null;
  }

  return standingsDescriptionLabelsRu.get(providerDescription.trim()) ?? providerDescription;
}

const standingsFormLabelsRu = {
  W: "В",
  D: "Н",
  L: "П",
} as const;

export function formatStandingsForm(providerForm: string | null): string | null {
  if (providerForm == null || !/^[WDL]+$/u.test(providerForm)) {
    return providerForm;
  }

  return [...providerForm]
    .map((result) => standingsFormLabelsRu[result as keyof typeof standingsFormLabelsRu])
    .join("");
}
