import { coachUuid, requireCoachCondition, type CoachOperatorStage, type CoachPlanPass } from "./coach-reconciliation-plan";

export function parseCoachOperatorArguments(args: readonly string[]) {
  const values = new Map<string, string>(), matchIds: string[] = [];
  for (const arg of args) {
    const match = /^--(stage|action|scope|match-id|manifest|batch|pass|confirm)=(.+)$/.exec(arg);
    requireCoachCondition(match, "COACH_INVALID_ARGUMENTS");
    const [, key, value] = match;
    if (key === "match-id") { requireCoachCondition(coachUuid.test(value), "COACH_INVALID_SCOPE"); matchIds.push(value); }
    else { requireCoachCondition(!values.has(key), "COACH_INVALID_ARGUMENTS"); values.set(key, value); }
  }
  const stage = values.get("stage"), action = values.get("action");
  requireCoachCondition(stage === "local" || stage === "staging", "COACH_EXPLICIT_STAGE_REQUIRED");
  requireCoachCondition(action === "plan" || action === "apply" || action === "verify", "COACH_INVALID_ACTION");
  if (action === "plan") {
    requireCoachCondition((values.get("scope") === "current-serie-a" && !matchIds.length || !values.has("scope") && matchIds.length > 0) &&
      matchIds.length <= 380 && new Set(matchIds).size === matchIds.length && [...values.keys()].every((k) => ["stage", "action", "scope"].includes(k)), "COACH_INVALID_SCOPE");
  } else requireCoachCondition(!matchIds.length && !values.has("scope"), "COACH_INVALID_ARGUMENTS");
  if (action === "apply") requireCoachCondition(/^[1-8]$/.test(values.get("batch") ?? "") &&
    ["profiles", "links"].includes(values.get("pass") ?? "") && /^[a-f0-9]{64}$/.test(values.get("confirm") ?? ""), "COACH_EXPLICIT_CONFIRMATION_REQUIRED");
  if (action === "verify") requireCoachCondition(!values.has("batch") && !values.has("pass") && !values.has("confirm"), "COACH_INVALID_ARGUMENTS");
  return { stage: stage as CoachOperatorStage, action, matchIds: matchIds.length ? matchIds : undefined,
    manifest: values.get("manifest"), batch: Number(values.get("batch")), pass: values.get("pass") as CoachPlanPass,
    confirm: values.get("confirm") ?? "" };
}

export function validateCoachOperatorConnection(stage: CoachOperatorStage, connection: string, uid: number | undefined) {
  const url = new URL(connection);
  requireCoachCondition(["postgres:", "postgresql:"].includes(url.protocol) && !url.search, "COACH_INVALID_CONNECTION");
  if (stage === "local") requireCoachCondition(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "15432" &&
    url.pathname === "/tuttoseriea_local", "COACH_LOCAL_TARGET_REQUIRED");
  else requireCoachCondition(stage === "staging" && uid === 0 && url.hostname === "postgres" && (!url.port || url.port === "5432") &&
    url.pathname === "/tuttoseriea_staging", "COACH_STAGING_ROOT_TARGET_REQUIRED");
  return { stage, database: stage === "local" ? "tuttoseriea_local" : "tuttoseriea_staging" };
}
