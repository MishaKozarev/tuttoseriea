#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-release.sh
source "${SCRIPT_DIR}/lib-release.sh"
# shellcheck source=scripts/lib-run-job.sh
source "${SCRIPT_DIR}/lib-run-job.sh"

if [[ "$#" -ne 0 ]]; then
  error "run-job-staging.sh accepts no command-line arguments"
fi

if [[ -n "${GITHUB_REF:-}" && "${GITHUB_REF}" != "refs/heads/main" ]]; then
  error "Run Job Staging must run from refs/heads/main"
fi

require_env RUN_JOB_TYPE
require_env STAGING_SSH_HOST
require_env STAGING_SSH_KNOWN_HOSTS
require_env STAGING_SSH_PRIVATE_KEY

RUN_JOB_MATCH_ID="${RUN_JOB_MATCH_ID:-}"
run_job_args=()

if run_job_type_requires_match_id_for_environment staging "$RUN_JOB_TYPE"; then
  if ! validate_run_job_match_id "$RUN_JOB_MATCH_ID"; then
    error "${RUN_JOB_TYPE} requires RUN_JOB_MATCH_ID as a lowercase canonical UUID"
  fi

  run_job_args=(--match-id "$RUN_JOB_MATCH_ID")
elif [[ -n "$RUN_JOB_MATCH_ID" ]]; then
  error "${RUN_JOB_TYPE} does not accept RUN_JOB_MATCH_ID"
fi

require_run_job_invocation_for_environment staging "$RUN_JOB_TYPE" "${run_job_args[@]}"

STAGING_SSH_PORT="${STAGING_SSH_PORT:-56777}"
STAGING_SSH_USER="${STAGING_SSH_USER:-deploy}"

key_file="$(mktemp)"
known_hosts_file="$(mktemp)"

cleanup() {
  rm -f "$key_file" "$known_hosts_file"
}

trap cleanup EXIT

printf '%s\n' "$STAGING_SSH_PRIVATE_KEY" > "$key_file"
chmod 600 "$key_file"

printf '%s\n' "$STAGING_SSH_KNOWN_HOSTS" > "$known_hosts_file"
chmod 600 "$known_hosts_file"

ssh_options=(
  -i "$key_file"
  -p "$STAGING_SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout=20
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$known_hosts_file"
)

printf 'Running STAGING job through the documented VDS contract: %s\n' "$RUN_JOB_TYPE"

ssh "${ssh_options[@]}" "${STAGING_SSH_USER}@${STAGING_SSH_HOST}" \
  run-job "$RUN_JOB_TYPE" "${run_job_args[@]}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### STAGING run-job\n\n'
    printf '| Field | Value |\n'
    printf '| --- | --- |\n'
    printf '| Job type | `%s` |\n' "$RUN_JOB_TYPE"
    if [[ "${#run_job_args[@]}" -eq 0 ]]; then
      printf '| VDS command | `run-job %s` |\n' "$RUN_JOB_TYPE"
    else
      printf '| VDS command | `run-job %s --match-id %s` |\n' "$RUN_JOB_TYPE" "$RUN_JOB_MATCH_ID"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi
