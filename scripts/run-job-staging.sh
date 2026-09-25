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

require_run_job_type "$RUN_JOB_TYPE"

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

ssh "${ssh_options[@]}" "${STAGING_SSH_USER}@${STAGING_SSH_HOST}" run-job "$RUN_JOB_TYPE"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### STAGING run-job\n\n'
    printf '| Field | Value |\n'
    printf '| --- | --- |\n'
    printf '| Job type | `%s` |\n' "$RUN_JOB_TYPE"
    printf '| VDS command | `run-job %s` |\n' "$RUN_JOB_TYPE"
  } >> "$GITHUB_STEP_SUMMARY"
fi
