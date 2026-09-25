#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-release.sh
source "${SCRIPT_DIR}/lib-release.sh"
# shellcheck source=scripts/lib-run-job.sh
source "${SCRIPT_DIR}/lib-run-job.sh"

valid_type="football.sync-serie-a-foundation"
invalid_types=(
  ""
  "football.sync-serie-a-foundation --season 2025"
  "football.sync-serie-a-foundation;uname"
  "football.sync-serie-a-foundation$(printf '\n')echo"
  "football.sync-other"
)

validate_run_job_type "$valid_type" ||
  error "Allowed run-job type was rejected"

for invalid_type in "${invalid_types[@]}"; do
  if validate_run_job_type "$invalid_type"; then
    error "Invalid run-job type was accepted: ${invalid_type}"
  fi
done

for script in \
  "${SCRIPT_DIR}/lib-run-job.sh" \
  "${SCRIPT_DIR}/run-job-staging.sh" \
  "${SCRIPT_DIR}/run-job-production.sh"; do
  if grep -Eq 'docker|sudo|eval|bash -c|sh -c' "$script"; then
    error "Repository-side run-job wrapper contains a forbidden primitive: ${script}"
  fi
done

grep -q 'type: choice' "${SCRIPT_DIR}/../.github/workflows/run-job-staging.yml" ||
  error "Staging run-job workflow must use a choice input"
grep -q 'football.sync-serie-a-foundation' "${SCRIPT_DIR}/../.github/workflows/run-job-staging.yml" ||
  error "Staging run-job workflow does not whitelist the Football sync job"
grep -q 'type: choice' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml" ||
  error "Production run-job workflow must use a choice input"
grep -q 'football.sync-serie-a-foundation' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml" ||
  error "Production run-job workflow does not whitelist the Football sync job"

vds_common="${SCRIPT_DIR}/vds/tuttoseriea-run-job-common.sh"

for required_fragment in \
  "current-release" \
  "validate_job_type" \
  "ghcr.io/mishakozarev/tuttoseriea/web" \
  "--pull never" \
  "--env-file \"\$runtime_env\"" \
  "--env-file \"\$runner_env\"" \
  "\"\$image_ref\"" \
  "node /app/job-runner/cli.js --type \"\$job_type\""; do
  grep -q -- "$required_fragment" "$vds_common" ||
    error "VDS run-job common script is missing required fragment: ${required_fragment}"
done

if grep -Eq 'docker exec|eval|bash -c|sh -c' "$vds_common"; then
  error "VDS run-job script uses a forbidden execution primitive"
fi

printf 'run_job_wrapper_check=passed\n'
printf 'run_job_unknown_type_rejected=true\n'
printf 'run_job_unexpected_arguments_rejected=true\n'
printf 'run_job_shell_metacharacters_rejected=true\n'
printf 'run_job_repository_wrapper_no_docker_or_sudo=true\n'
printf 'run_job_vds_exact_image_resolution=true\n'
