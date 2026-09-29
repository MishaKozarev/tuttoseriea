import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDirectory, "..");
const foundationJobType = "football.sync-serie-a-foundation";
const matchesJobType = "football.sync-serie-a-matches";
const standingsJobType = "football.sync-serie-a-standings";
const squadsJobType = "football.sync-serie-a-squads";
const playerStatisticsJobType = "football.sync-serie-a-player-statistics";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validateRunJobType(environment: "staging" | "production", value: string): boolean {
  if (value === foundationJobType) {
    return true;
  }

  return (
    environment === "staging" &&
    (value === matchesJobType ||
      value === standingsJobType ||
      value === squadsJobType ||
      value === playerStatisticsJobType)
  );
}

for (const invalidType of [
  "",
  `${foundationJobType} --season 2025`,
  `${matchesJobType} --round 1`,
  `${standingsJobType} --season 2025`,
  `${squadsJobType} --team 1`,
  `${playerStatisticsJobType} --page 1`,
  `${foundationJobType};uname`,
  `${foundationJobType}\necho`,
  "football.sync-other",
]) {
  assert(
    !validateRunJobType("staging", invalidType) &&
      !validateRunJobType("production", invalidType),
    `Invalid run-job type accepted: ${invalidType}`,
  );
}

assert(
  validateRunJobType("staging", foundationJobType) &&
    validateRunJobType("staging", matchesJobType) &&
    validateRunJobType("staging", standingsJobType) &&
    validateRunJobType("staging", squadsJobType) &&
    validateRunJobType("staging", playerStatisticsJobType),
  "STAGING allowed run-job type was rejected",
);
assert(
  validateRunJobType("production", foundationJobType),
  "PRODUCTION foundation run-job type was rejected",
);
assert(
  !validateRunJobType("production", matchesJobType),
  "PRODUCTION unexpectedly accepted the STAGING-only matches job type",
);
assert(
  !validateRunJobType("production", standingsJobType),
  "PRODUCTION unexpectedly accepted the STAGING-only standings job type",
);
assert(
  !validateRunJobType("production", squadsJobType),
  "PRODUCTION unexpectedly accepted the STAGING-only squads job type",
);
assert(
  !validateRunJobType("production", playerStatisticsJobType),
  "PRODUCTION unexpectedly accepted the STAGING-only player-statistics job type",
);

for (const relativePath of [
  "scripts/lib-run-job.sh",
  "scripts/run-job-staging.sh",
  "scripts/run-job-production.sh",
]) {
  const content = readRepoFile(relativePath);

  assert(
    !/\b(docker|sudo|eval)\b|bash -c|sh -c/u.test(content),
    `${relativePath} contains a forbidden repository-side primitive`,
  );
}

const runJobLibrary = readRepoFile("scripts/lib-run-job.sh");
const stagingWrapper = readRepoFile("scripts/run-job-staging.sh");
const productionWrapper = readRepoFile("scripts/run-job-production.sh");

assert(
  runJobLibrary.includes("RUN_JOB_STAGING_ALLOWED_TYPES") &&
    runJobLibrary.includes(matchesJobType) &&
    runJobLibrary.includes(standingsJobType) &&
    runJobLibrary.includes(squadsJobType) &&
    runJobLibrary.includes(playerStatisticsJobType) &&
    runJobLibrary.includes("RUN_JOB_PRODUCTION_ALLOWED_TYPES"),
  "Repository run-job library is missing environment-specific allowlists",
);
const readShellArray = (name: string): string[] | undefined =>
  runJobLibrary
    .match(new RegExp(`${name}=\\(([^)]*)\\)`, "u"))?.[1]
    ?.match(/"[^"]+"/gu)
    ?.map((value) => value.slice(1, -1));

assert(
  JSON.stringify(readShellArray("RUN_JOB_STAGING_ALLOWED_TYPES")) ===
    JSON.stringify([
      foundationJobType,
      matchesJobType,
      standingsJobType,
      squadsJobType,
      playerStatisticsJobType,
    ]),
  "Repository STAGING allowlist must contain exactly the five approved job types",
);
assert(
  JSON.stringify(readShellArray("RUN_JOB_PRODUCTION_ALLOWED_TYPES")) ===
    JSON.stringify([foundationJobType]),
  "Repository PRODUCTION allowlist changed from foundation-only",
);
assert(
  stagingWrapper.includes('require_run_job_type_for_environment staging "$RUN_JOB_TYPE"'),
  "STAGING wrapper does not enforce the STAGING allowlist",
);
assert(
  productionWrapper.includes('require_run_job_type "$RUN_JOB_TYPE"'),
  "PRODUCTION wrapper does not retain the foundation-only allowlist",
);

const stagingWorkflow = readRepoFile(".github/workflows/run-job-staging.yml");
const productionWorkflow = readRepoFile(".github/workflows/run-job-production.yml");

assert(stagingWorkflow.includes("type: choice"), "STAGING workflow must use a choice input");
assert(
  stagingWorkflow.includes(`- ${foundationJobType}`) &&
    stagingWorkflow.includes(`- ${matchesJobType}`) &&
    stagingWorkflow.includes(`- ${standingsJobType}`) &&
    stagingWorkflow.includes(`- ${squadsJobType}`) &&
    stagingWorkflow.includes(`- ${playerStatisticsJobType}`),
  "STAGING workflow must whitelist all five approved Football job types",
);
const stagingWorkflowOptions = stagingWorkflow
  .match(/options:\r?\n((?:\s+- [^\r\n]+\r?\n?)+)/u)?.[1]
  ?.split(/\r?\n/u)
  .map((line) => line.trim().replace(/^-\s+/u, ""))
  .filter(Boolean);

assert(
  JSON.stringify(stagingWorkflowOptions) ===
    JSON.stringify([
      foundationJobType,
      matchesJobType,
      standingsJobType,
      squadsJobType,
      playerStatisticsJobType,
    ]),
  "STAGING workflow choice list must contain exactly the five approved job types",
);
const productionWorkflowOptions = productionWorkflow
  .match(/options:\r?\n((?:\s+- [^\r\n]+\r?\n?)+)/u)?.[1]
  ?.split(/\r?\n/u)
  .map((line) => line.trim().replace(/^-\s+/u, ""))
  .filter(Boolean);

assert(
  productionWorkflow.includes("type: choice") &&
    productionWorkflow.includes(`- ${foundationJobType}`),
  "PRODUCTION workflow must retain the foundation job choice",
);
assert(
  !productionWorkflow.includes(matchesJobType) &&
    !productionWorkflow.includes(standingsJobType) &&
    !productionWorkflow.includes(squadsJobType) &&
    !productionWorkflow.includes(playerStatisticsJobType),
  "PRODUCTION workflow must not whitelist STAGING-only job types",
);
assert(
  JSON.stringify(productionWorkflowOptions) === JSON.stringify([foundationJobType]),
  "PRODUCTION workflow choice list changed from foundation-only",
);

const vdsCommon = readRepoFile("scripts/vds/tuttoseriea-run-job-common.sh");
const vdsStagingReader = readRepoFile("scripts/vds/tuttoseriea-read-current-staging");
const vdsStagingDispatcher = readRepoFile("scripts/vds/tuttoseriea-ssh-staging");
const vdsStagingWrapper = readRepoFile("scripts/vds/tuttoseriea-run-job-staging");
const vdsSudoers = readRepoFile("scripts/vds/tuttoseriea-deploy.sudoers");
const readVdsAllowedTypes = (environment: "staging" | "production"): string[] | undefined =>
  vdsCommon
    .match(
      new RegExp(
        `${environment}\\)\\s+case "\\$job_type" in\\s+([^\\r\\n]+)\\)`,
        "u",
      ),
    )?.[1]
    ?.split(/\s+\|\s+/u);

assert(
  JSON.stringify(readVdsAllowedTypes("staging")) ===
    JSON.stringify([
      foundationJobType,
      matchesJobType,
      standingsJobType,
      squadsJobType,
      playerStatisticsJobType,
    ]),
  "VDS common STAGING allowlist must contain exactly the five approved job types",
);
assert(
  JSON.stringify(readVdsAllowedTypes("production")) ===
    JSON.stringify([foundationJobType]),
  "VDS common PRODUCTION allowlist changed from foundation-only",
);

for (const requiredFragment of [
  "read_current_release",
  "/usr/local/sbin/tuttoseriea-read-current-staging",
  "validate_job_type",
  matchesJobType,
  standingsJobType,
  squadsJobType,
  playerStatisticsJobType,
  "ghcr.io/mishakozarev/tuttoseriea/web",
  "--pull never",
  "--env-file \"$runtime_env\"",
  "--env-file \"$runner_env\"",
  "\"$image_ref\"",
  "node /app/job-runner/cli.js --type \"$job_type\"",
]) {
  assert(
    vdsCommon.includes(requiredFragment),
    `VDS run-job common script is missing required fragment: ${requiredFragment}`,
  );
}

assert(
  !vdsCommon.includes("${base_dir}/current-release") &&
    !vdsCommon.includes("/srv/tuttoseriea/staging/current-release"),
  "VDS run-job common script must not guess deployment-state filesystem paths",
);

assert(!/docker exec|eval|bash -c|sh -c/u.test(vdsCommon), "VDS run-job script uses a forbidden execution primitive");

const stagingRunJobCommands = Array.from(
  vdsStagingDispatcher.matchAll(/^\s+"(run-job [^"]+)"\)$/gmu),
  (match) => match[1],
);

assert(
  JSON.stringify(stagingRunJobCommands) ===
    JSON.stringify([
      `run-job ${foundationJobType}`,
      `run-job ${matchesJobType}`,
      `run-job ${standingsJobType}`,
      `run-job ${squadsJobType}`,
      `run-job ${playerStatisticsJobType}`,
    ]),
  "STAGING forced command must contain exactly the five approved run-job commands",
);
assert(
  vdsStagingDispatcher.includes(
    "^(deploy|verify)\\ ([0-9a-f]{40})\\ (sha256:[0-9a-f]{64})(\\ (sha256:[0-9a-f]{64}))?$",
  ),
  "STAGING forced command changed the approved deploy/verify parser",
);
assert(
  !/eval|bash -c|sh -c|run-job-production/u.test(vdsStagingDispatcher),
  "STAGING forced command contains a forbidden execution primitive",
);

assert(
  vdsStagingWrapper.includes('if [[ "$#" -ne 1 ]]') &&
    vdsStagingWrapper.includes(
      'run_tuttoseriea_job "staging" "tuttoseriea-staging" "$1"',
    ) &&
    !vdsStagingWrapper.includes("football.sync-"),
  "VDS STAGING run-job wrapper must remain a generic one-argument delegator",
);

const expectedSudoers = [
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-rollback-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$",
  "deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-rollback-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$",
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-read-previous-production ""',
  `deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging ${foundationJobType}`,
  `deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging ${matchesJobType}`,
  `deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging ${standingsJobType}`,
  `deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging ${squadsJobType}`,
  `deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging ${playerStatisticsJobType}`,
];
const actualSudoers = vdsSudoers.trimEnd().split(/\r?\n/u);

assert(
  JSON.stringify(actualSudoers) === JSON.stringify(expectedSudoers),
  "VDS sudoers template differs from the complete approved contract",
);
assert(
  !vdsSudoers.includes("tuttoseriea-run-job-production") &&
    !/tuttoseriea-run-job-staging .*[*?]/u.test(vdsSudoers) &&
    !/\/usr\/bin\/docker|\/bin\/(?:ba)?sh/u.test(vdsSudoers),
  "VDS sudoers template contains a wildcard or forbidden privilege",
);

for (const requiredFragment of [
  "Usage: tuttoseriea-read-current-staging accepts no arguments",
  "/srv/tuttoseriea/staging/state/current-release",
  "^[0-9a-f]{40}$",
  "^sha256:[0-9a-f]{64}$",
]) {
  assert(
    vdsStagingReader.includes(requiredFragment),
    `STAGING current-release reader is missing required fragment: ${requiredFragment}`,
  );
}

const releaseTuplePattern =
  /^[0-9a-f]{40} sha256:[0-9a-f]{64} sha256:[0-9a-f]{64}$/u;

assert(
  releaseTuplePattern.test(
    `${"a".repeat(40)} sha256:${"b".repeat(64)} sha256:${"c".repeat(64)}`,
  ),
  "Canonical release tuple fixture was rejected",
);

for (const invalidTuple of [
  `${"A".repeat(40)} sha256:${"b".repeat(64)} sha256:${"c".repeat(64)}`,
  `${"a".repeat(39)} sha256:${"b".repeat(64)} sha256:${"c".repeat(64)}`,
  `${"a".repeat(40)} ${"b".repeat(64)} sha256:${"c".repeat(64)}`,
  `${"a".repeat(40)} sha256:${"b".repeat(63)} sha256:${"c".repeat(64)}`,
  `${"a".repeat(40)} sha256:${"b".repeat(64)} sha256:${"c".repeat(64)} extra`,
]) {
  assert(!releaseTuplePattern.test(invalidTuple), `Malformed release tuple accepted: ${invalidTuple}`);
}

console.log("run_job_wrapper_check=passed");
console.log("run_job_unknown_type_rejected=true");
console.log("run_job_unexpected_arguments_rejected=true");
console.log("run_job_shell_metacharacters_rejected=true");
console.log("run_job_repository_wrapper_no_docker_or_sudo=true");
console.log("run_job_vds_exact_image_resolution=true");
console.log("run_job_staging_reader_contract=true");
console.log("run_job_staging_matches_whitelisted=true");
console.log("run_job_staging_standings_whitelisted=true");
console.log("run_job_staging_squads_whitelisted=true");
console.log("run_job_staging_player_statistics_whitelisted=true");
console.log("run_job_production_matches_rejected=true");
console.log("run_job_production_standings_rejected=true");
console.log("run_job_production_squads_rejected=true");
console.log("run_job_production_player_statistics_rejected=true");
console.log("run_job_staging_forced_command_contract=true");
console.log("run_job_staging_sudoers_contract=true");
console.log("run_job_staging_wrapper_generic=true");
