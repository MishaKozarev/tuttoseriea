#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-release.sh
source "${SCRIPT_DIR}/lib-release.sh"
# shellcheck source=scripts/lib-run-job.sh
source "${SCRIPT_DIR}/lib-run-job.sh"

foundation_type="football.sync-serie-a-foundation"
matches_type="football.sync-serie-a-matches"
invalid_types=(
  ""
  "football.sync-serie-a-foundation --season 2025"
  "football.sync-serie-a-matches --round 1"
  "football.sync-serie-a-foundation;uname"
  "football.sync-serie-a-foundation$(printf '\n')echo"
  "football.sync-other"
)

validate_run_job_type_for_environment staging "$foundation_type" ||
  error "STAGING foundation run-job type was rejected"
validate_run_job_type_for_environment staging "$matches_type" ||
  error "STAGING matches run-job type was rejected"
validate_run_job_type_for_environment production "$foundation_type" ||
  error "PRODUCTION foundation run-job type was rejected"

if validate_run_job_type_for_environment production "$matches_type"; then
  error "PRODUCTION unexpectedly accepted the STAGING-only matches job type"
fi

for invalid_type in "${invalid_types[@]}"; do
  if validate_run_job_type_for_environment staging "$invalid_type" ||
    validate_run_job_type_for_environment production "$invalid_type"; then
    error "Invalid environment-specific run-job type was accepted: ${invalid_type}"
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

grep -Fq 'require_run_job_type_for_environment staging "$RUN_JOB_TYPE"' "${SCRIPT_DIR}/run-job-staging.sh" ||
  error "STAGING wrapper does not enforce the STAGING allowlist"
grep -Fq 'require_run_job_type "$RUN_JOB_TYPE"' "${SCRIPT_DIR}/run-job-production.sh" ||
  error "PRODUCTION wrapper does not retain the foundation-only allowlist"

grep -q 'type: choice' "${SCRIPT_DIR}/../.github/workflows/run-job-staging.yml" ||
  error "Staging run-job workflow must use a choice input"
grep -q 'football.sync-serie-a-foundation' "${SCRIPT_DIR}/../.github/workflows/run-job-staging.yml" ||
  error "Staging run-job workflow does not whitelist the Football sync job"
grep -q 'football.sync-serie-a-matches' "${SCRIPT_DIR}/../.github/workflows/run-job-staging.yml" ||
  error "Staging run-job workflow does not whitelist the matches sync job"
grep -q 'type: choice' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml" ||
  error "Production run-job workflow must use a choice input"
grep -q 'football.sync-serie-a-foundation' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml" ||
  error "Production run-job workflow does not whitelist the Football sync job"

if grep -q 'football.sync-serie-a-matches' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml"; then
  error "Production run-job workflow must not whitelist the STAGING-only matches sync job"
fi

vds_common="${SCRIPT_DIR}/vds/tuttoseriea-run-job-common.sh"
vds_reader="${SCRIPT_DIR}/vds/tuttoseriea-read-current-staging"

for required_fragment in \
  "read_current_release" \
  "/usr/local/sbin/tuttoseriea-read-current-staging" \
  "validate_job_type" \
  "football.sync-serie-a-matches" \
  "ghcr.io/mishakozarev/tuttoseriea/web" \
  "--pull never" \
  "--env-file \"\$runtime_env\"" \
  "--env-file \"\$runner_env\"" \
  "\"\$image_ref\"" \
  "node /app/job-runner/cli.js --type \"\$job_type\""; do
  grep -q -- "$required_fragment" "$vds_common" ||
    error "VDS run-job common script is missing required fragment: ${required_fragment}"
done

if grep -q '\${base_dir}/current-release' "$vds_common" ||
  grep -q '/srv/tuttoseriea/staging/current-release' "$vds_common"; then
  error "VDS run-job common script must not guess deployment-state filesystem paths"
fi

if grep -Eq 'docker exec|eval|bash -c|sh -c' "$vds_common"; then
  error "VDS run-job script uses a forbidden execution primitive"
fi

bash -n "$vds_reader"

if bash "$vds_reader" unexpected-argument >/dev/null 2>&1; then
  error "STAGING current-release reader accepted an unexpected argument"
fi

for required_fragment in \
  "/srv/tuttoseriea/staging/state/current-release" \
  "^[0-9a-f]{40}$" \
  "^sha256:[0-9a-f]{64}$" \
  "accepts no arguments"; do
  grep -Fq -- "$required_fragment" "$vds_reader" ||
    error "STAGING current-release reader is missing required fragment: ${required_fragment}"
done

printf 'run_job_wrapper_check=passed\n'
printf 'run_job_unknown_type_rejected=true\n'
printf 'run_job_unexpected_arguments_rejected=true\n'
printf 'run_job_shell_metacharacters_rejected=true\n'
printf 'run_job_repository_wrapper_no_docker_or_sudo=true\n'
printf 'run_job_vds_exact_image_resolution=true\n'
printf 'run_job_staging_reader_contract=true\n'
printf 'run_job_staging_matches_whitelisted=true\n'
printf 'run_job_production_matches_rejected=true\n'
