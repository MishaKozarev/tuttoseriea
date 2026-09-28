#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-release.sh
source "${SCRIPT_DIR}/lib-release.sh"
# shellcheck source=scripts/lib-run-job.sh
source "${SCRIPT_DIR}/lib-run-job.sh"

foundation_type="football.sync-serie-a-foundation"
matches_type="football.sync-serie-a-matches"
standings_type="football.sync-serie-a-standings"
squads_type="football.sync-serie-a-squads"
vds_common="${SCRIPT_DIR}/vds/tuttoseriea-run-job-common.sh"
vds_reader="${SCRIPT_DIR}/vds/tuttoseriea-read-current-staging"
vds_staging_dispatcher="${SCRIPT_DIR}/vds/tuttoseriea-ssh-staging"
vds_staging_wrapper="${SCRIPT_DIR}/vds/tuttoseriea-run-job-staging"
vds_sudoers="${SCRIPT_DIR}/vds/tuttoseriea-deploy.sudoers"
invalid_types=(
  ""
  "football.sync-serie-a-foundation --season 2025"
  "football.sync-serie-a-matches --round 1"
  "football.sync-serie-a-standings --season 2025"
  "football.sync-serie-a-foundation;uname"
  "football.sync-serie-a-foundation$(printf '\n')echo"
  "football.sync-other"
)

validate_run_job_type_for_environment staging "$foundation_type" ||
  error "STAGING foundation run-job type was rejected"
validate_run_job_type_for_environment staging "$matches_type" ||
  error "STAGING matches run-job type was rejected"
validate_run_job_type_for_environment staging "$standings_type" ||
  error "STAGING standings run-job type was rejected"
validate_run_job_type_for_environment production "$foundation_type" ||
  error "PRODUCTION foundation run-job type was rejected"

[[ "${#RUN_JOB_STAGING_ALLOWED_TYPES[@]}" -eq 3 ]] ||
  error "STAGING repository allowlist must contain exactly three job types"
[[ "${#RUN_JOB_PRODUCTION_ALLOWED_TYPES[@]}" -eq 1 ]] ||
  error "PRODUCTION repository allowlist must contain exactly one job type"

if validate_run_job_type_for_environment production "$matches_type"; then
  error "PRODUCTION unexpectedly accepted the STAGING-only matches job type"
fi

if validate_run_job_type_for_environment production "$standings_type"; then
  error "PRODUCTION unexpectedly accepted the STAGING-only standings job type"
fi

if validate_run_job_type_for_environment staging "$squads_type" ||
  validate_run_job_type_for_environment production "$squads_type"; then
  error "Operational allowlists must defer the squads job type"
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
grep -q 'football.sync-serie-a-standings' "${SCRIPT_DIR}/../.github/workflows/run-job-staging.yml" ||
  error "Staging run-job workflow does not whitelist the standings sync job"
if grep -q "$squads_type" "${SCRIPT_DIR}/lib-run-job.sh" ||
  grep -q "$squads_type" "${SCRIPT_DIR}/../.github/workflows/run-job-staging.yml" ||
  grep -q "$squads_type" "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml"; then
  error "Repository operational workflow must defer the squads job type"
fi
grep -q 'type: choice' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml" ||
  error "Production run-job workflow must use a choice input"
grep -q 'football.sync-serie-a-foundation' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml" ||
  error "Production run-job workflow does not whitelist the Football sync job"

if grep -q 'football.sync-serie-a-matches' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml"; then
  error "Production run-job workflow must not whitelist the STAGING-only matches sync job"
fi

if grep -q 'football.sync-serie-a-standings' "${SCRIPT_DIR}/../.github/workflows/run-job-production.yml"; then
  error "Production run-job workflow must not whitelist the STAGING-only standings sync job"
fi

for required_fragment in \
  "read_current_release" \
  "/usr/local/sbin/tuttoseriea-read-current-staging" \
  "validate_job_type" \
  "football.sync-serie-a-matches" \
  "football.sync-serie-a-standings" \
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

if grep -q "$squads_type" "$vds_common" ||
  grep -q "$squads_type" "$vds_staging_dispatcher" ||
  grep -q "$squads_type" "$vds_sudoers"; then
  error "Root-owned operational templates must defer the squads job type"
fi

bash -n "$vds_common"
bash -n "$vds_reader"
bash -n "$vds_staging_dispatcher"
bash -n "$vds_staging_wrapper"

# The installed dispatcher hard-codes /usr/bin/sudo. Exercise a temporary copy
# that replaces only that executable with a harmless argv recorder.
dispatcher_test_dir="$(mktemp -d)"
trap 'rm -rf "$dispatcher_test_dir"' EXIT
fake_sudo="${dispatcher_test_dir}/sudo"
dispatcher_under_test="${dispatcher_test_dir}/tuttoseriea-ssh-staging"

cat > "$fake_sudo" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@"
EOF
chmod 700 "$fake_sudo"
sed "s#/usr/bin/sudo#${fake_sudo}#g" "$vds_staging_dispatcher" > "$dispatcher_under_test"

assert_staging_dispatch() {
  local command="$1"
  local expected="$2"
  local actual

  actual="$(SSH_ORIGINAL_COMMAND="$command" bash "$dispatcher_under_test")" ||
    error "STAGING dispatcher rejected approved command: ${command}"

  [[ "$actual" == "$expected" ]] ||
    error "STAGING dispatcher routed '${command}' incorrectly"
}

reject_staging_dispatch() {
  local command="$1"

  if SSH_ORIGINAL_COMMAND="$command" bash "$dispatcher_under_test" >/dev/null 2>&1; then
    error "STAGING dispatcher accepted forbidden command: ${command}"
  fi
}

sha="$(printf 'a%.0s' {1..40})"
web_digest="sha256:$(printf 'b%.0s' {1..64})"
ai_digest="sha256:$(printf 'c%.0s' {1..64})"

assert_staging_dispatch \
  "run-job ${foundation_type}" \
  $'-n\n/usr/local/sbin/tuttoseriea-run-job-staging\nfootball.sync-serie-a-foundation'
assert_staging_dispatch \
  "run-job ${matches_type}" \
  $'-n\n/usr/local/sbin/tuttoseriea-run-job-staging\nfootball.sync-serie-a-matches'
assert_staging_dispatch \
  "run-job ${standings_type}" \
  $'-n\n/usr/local/sbin/tuttoseriea-run-job-staging\nfootball.sync-serie-a-standings'
assert_staging_dispatch \
  "deploy ${sha} ${web_digest}" \
  "$(printf '%s\n' -n /usr/local/sbin/tuttoseriea-deploy-staging "$sha" "$web_digest")"
assert_staging_dispatch \
  "deploy ${sha} ${web_digest} ${ai_digest}" \
  "$(printf '%s\n' -n /usr/local/sbin/tuttoseriea-deploy-staging "$sha" "$web_digest" "$ai_digest")"
assert_staging_dispatch \
  "verify ${sha} ${web_digest} ${ai_digest}" \
  "$(printf '%s\n' -n /usr/local/sbin/tuttoseriea-verify-staging "$sha" "$web_digest" "$ai_digest")"

for forbidden_command in \
  "" \
  "run-job" \
  "run-job  ${foundation_type}" \
  "run-job football.sync-other" \
  "run-job ${foundation_type} --season 2025" \
  "run-job ${matches_type} extra" \
  "run-job ${standings_type} extra" \
  "run-job ${squads_type}" \
  "run-job ${squads_type} extra" \
  "run-job ${foundation_type};uname" \
  "run-job ${foundation_type} && uname"; do
  reject_staging_dispatch "$forbidden_command"
done

grep -Fq 'if [[ "$#" -ne 1 ]]' "$vds_staging_wrapper" ||
  error "VDS STAGING run-job wrapper must accept exactly one argument"
grep -Fq 'run_tuttoseriea_job "staging" "tuttoseriea-staging" "$1"' "$vds_staging_wrapper" ||
  error "VDS STAGING run-job wrapper must remain a generic one-argument delegator"

if grep -Fq 'football.sync-' "$vds_staging_wrapper"; then
  error "VDS STAGING run-job wrapper must not duplicate the job allowlist"
fi

# shellcheck source=scripts/vds/tuttoseriea-run-job-common.sh
source "$vds_common"

validate_job_type staging "$foundation_type" ||
  error "VDS common wrapper rejected the STAGING foundation type"
validate_job_type staging "$matches_type" ||
  error "VDS common wrapper rejected the STAGING matches type"
validate_job_type staging "$standings_type" ||
  error "VDS common wrapper rejected the STAGING standings type"
validate_job_type production "$foundation_type" ||
  error "VDS common wrapper rejected the PRODUCTION foundation type"

for invalid_type in "${invalid_types[@]}"; do
  if validate_job_type staging "$invalid_type" ||
    validate_job_type production "$invalid_type"; then
    error "VDS common wrapper accepted an invalid type: ${invalid_type}"
  fi
done

if validate_job_type production "$matches_type"; then
  error "VDS common wrapper expanded the PRODUCTION allowlist"
fi

if validate_job_type production "$standings_type"; then
  error "VDS common wrapper expanded the PRODUCTION allowlist to standings"
fi

if validate_job_type staging "$squads_type" ||
  validate_job_type production "$squads_type"; then
  error "VDS common wrapper must defer the squads job type"
fi

expected_sudoers=(
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-staging ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-deploy-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-verify-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-rollback-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-rollback-production ^[0-9a-f]{40}[[:space:]]sha256:[0-9a-f]{64}[[:space:]]sha256:[0-9a-f]{64}$'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-read-previous-production ""'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging football.sync-serie-a-foundation'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging football.sync-serie-a-matches'
  'deploy ALL=(root) NOPASSWD: /usr/local/sbin/tuttoseriea-run-job-staging football.sync-serie-a-standings'
)
mapfile -t actual_sudoers < "$vds_sudoers"

[[ "${#actual_sudoers[@]}" -eq "${#expected_sudoers[@]}" ]] ||
  error "VDS sudoers template contains an unexpected number of rules"

for index in "${!expected_sudoers[@]}"; do
  [[ "${actual_sudoers[$index]}" == "${expected_sudoers[$index]}" ]] ||
    error "VDS sudoers template differs from the approved contract at line $((index + 1))"
done

if grep -Eq '/usr/local/sbin/tuttoseriea-run-job-staging .*[?*]|tuttoseriea-run-job-production|/usr/bin/docker|/bin/(ba)?sh' "$vds_sudoers"; then
  error "VDS sudoers template contains a wildcard or forbidden privilege"
fi

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
printf 'run_job_staging_standings_whitelisted=true\n'
printf 'run_job_production_matches_rejected=true\n'
printf 'run_job_production_standings_rejected=true\n'
printf 'run_job_squads_operationally_deferred=true\n'
printf 'run_job_staging_forced_command_contract=true\n'
printf 'run_job_staging_sudoers_contract=true\n'
printf 'run_job_staging_wrapper_generic=true\n'
