import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDirectory, "..");
const allowedJobType = "football.sync-serie-a-foundation";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validateRunJobType(value: string): boolean {
  return value === allowedJobType;
}

for (const invalidType of [
  "",
  `${allowedJobType} --season 2025`,
  `${allowedJobType};uname`,
  `${allowedJobType}\necho`,
  "football.sync-other",
]) {
  assert(!validateRunJobType(invalidType), `Invalid run-job type accepted: ${invalidType}`);
}

assert(validateRunJobType(allowedJobType), "Allowed run-job type was rejected");

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

for (const relativePath of [
  ".github/workflows/run-job-staging.yml",
  ".github/workflows/run-job-production.yml",
]) {
  const content = readRepoFile(relativePath);

  assert(content.includes("type: choice"), `${relativePath} must use a choice input`);
  assert(
    content.includes(`- ${allowedJobType}`),
    `${relativePath} must whitelist ${allowedJobType}`,
  );
}

const vdsCommon = readRepoFile("scripts/vds/tuttoseriea-run-job-common.sh");

for (const requiredFragment of [
  "current-release",
  "validate_job_type",
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

assert(!/docker exec|eval|bash -c|sh -c/u.test(vdsCommon), "VDS run-job script uses a forbidden execution primitive");

console.log("run_job_wrapper_check=passed");
console.log("run_job_unknown_type_rejected=true");
console.log("run_job_unexpected_arguments_rejected=true");
console.log("run_job_shell_metacharacters_rejected=true");
console.log("run_job_repository_wrapper_no_docker_or_sudo=true");
console.log("run_job_vds_exact_image_resolution=true");
