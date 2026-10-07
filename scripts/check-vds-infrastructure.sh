#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VDS_DIR="${SCRIPT_DIR}/vds"
mode="${1:-all}"
if [[ "$#" -gt 1 || ! "$mode" =~ ^(all|--shell-only|--compose-only)$ ]]; then
  printf 'Usage: %s [--shell-only|--compose-only]\n' "$0" >&2
  exit 1
fi
error() { printf '%s\n' "$*" >&2; exit 1; }
for source in "$VDS_DIR"/tuttoseriea-* "$0"; do
  case "$source" in *.sudoers|*.service|*.timer) continue;; esac
  bash -n "$source"
done

scratch_base="${TMPDIR:-/tmp}"
scratch="$(mktemp -d "${scratch_base}/tuttoseriea-vds-check.XXXXXXXX")"
scratch="$(cd -- "$scratch" && pwd -P)"
scratch_base="$(cd -- "$scratch_base" && pwd -P)"
real_rm="$(command -v rm)"
cleanup() {
  case "$scratch" in
    "${scratch_base}/tuttoseriea-vds-check."*) "$real_rm" -rf -- "$scratch";;
    *) printf 'Refusing cleanup outside the test directory\n' >&2;;
  esac
}
trap cleanup EXIT
mkdir -p "$scratch/compose"

if [[ "$mode" != --shell-only ]]; then
  command -v docker >/dev/null || error "Docker Compose CLI is required"
  command -v node >/dev/null || error "Node.js is required"
  for environment in staging production; do
    config="${scratch}/compose/${environment}.json"
    docker compose --project-directory "$scratch/compose" \
      -f "${VDS_DIR}/compose-${environment}.yaml" config \
      --no-env-resolution --no-interpolate --no-path-resolution --format json > "$config"
    node - "$environment" "$config" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const environment = process.argv[2];
const config = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
assert.equal(config.name, "tuttoseriea-" + environment);
assert.deepEqual(Object.keys(config.services).sort(), ["ai-service", "postgres", "web"]);
assert.equal(config.services.web.image, "${WEB_IMAGE:?WEB_IMAGE is required}");
assert.equal(config.services["ai-service"].image, "${AI_SERVICE_IMAGE:?AI_SERVICE_IMAGE is required}");
assert.equal(config.services.postgres.image, "pgvector/pgvector:0.8.6-pg18");
for (const [name, service] of Object.entries(config.services)) {
  assert.equal(service.restart, "unless-stopped");
  const allowed = {
    web: ["image", "restart", "ports", "env_file", "depends_on", "networks"],
    "ai-service": ["image", "restart", "env_file", "networks"],
    postgres: ["image", "restart", "env_file", "volumes", "healthcheck", "networks"],
  }[name];
  assert.ok(Object.keys(service).every((key) => allowed.includes(key)), name + ": unexpected runtime setting");
  const expectedFile = { web: "./runtime.env", "ai-service": "./ai-service.env", postgres: "./postgres.env" }[name];
  assert.equal(service.env_file.length, 1);
  assert.equal(service.env_file[0].path ?? service.env_file[0], expectedFile);
}
const port = config.services.web.ports;
assert.equal(port.length, 1);
assert.equal(port[0].host_ip, "127.0.0.1");
assert.equal(port[0].target, 3000);
assert.equal(String(port[0].published), environment === "staging" ? "8898" : "8899");
assert.equal(config.services.web.depends_on["ai-service"].condition, "service_healthy");
assert.deepEqual(Object.keys(config.services.web.depends_on), ["ai-service"]);
const volume = config.services.postgres.volumes;
assert.equal(volume.length, 1);
assert.equal(volume[0].type, "volume");
assert.equal(volume[0].source, "postgres_data");
assert.equal(volume[0].target, "/var/lib/postgresql");
assert.deepEqual(Object.keys(config.volumes), ["postgres_data"]);
assert.equal(config.volumes.postgres_data.name, "tuttoseriea-" + environment + "_postgres_data");
assert.deepEqual(config.services.postgres.healthcheck, {
  test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"],
  timeout: "5s", interval: "10s", retries: 5, start_period: "10s",
});
NODE
  done
  printf 'vds_compose_check=passed\n'
else
  printf 'vds_compose_check=not_run\n'
fi
if [[ "$mode" == --compose-only ]]; then
  printf 'vds_shell_behavior_check=not_run\n'
  exit 0
fi

[[ "$(uname -s)" == Linux ]] || error "Behavior checks require Linux and real flock"
command -v flock >/dev/null || error "Real flock is required"
real_flock="$(command -v flock)"
real_mv="$(command -v mv)"
export VDS_TEST_ROOT="$scratch" VDS_TEST_TRACE="${scratch}/trace"
export VDS_REAL_FLOCK="$real_flock" VDS_REAL_MV="$real_mv" VDS_REAL_RM="$real_rm"
export VDS_FAIL_EVENT=""
mkdir -p "$scratch/bin" "$scratch/scripts" "$scratch/srv"/{staging,production}/{state,config}

# Only disposable copies use test paths and stubs; canonical interfaces stay fixed.
for source in "$VDS_DIR"/tuttoseriea-*; do
  case "$source" in *.sudoers|*.service|*.timer) continue;; esac
  sed \
    -e "s|/srv/tuttoseriea|${scratch}/srv|g" \
    -e "s|/run/lock/tuttoseriea-staging-deploy.lock|${scratch}/staging.lock|g" \
    -e "s|/run/lock/tuttoseriea-production-deploy.lock|${scratch}/production.lock|g" \
    -e "s|/usr/bin/docker|${scratch}/bin/docker|g" \
    -e "s|/usr/bin/sync|${scratch}/bin/sync|g" \
    -e "s|/usr/bin/mv|${scratch}/bin/mv|g" \
    -e "s|/usr/bin/rm|${scratch}/bin/rm|g" \
    -e "s|/usr/bin/sudo|${scratch}/bin/sudo|g" \
    "$source" > "${scratch}/scripts/${source##*/}"
done
cat > "$scratch/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
event=""
if [[ "$1" == compose ]]; then
  file="$3"; shift 3
  case "$file" in
    "$VDS_TEST_ROOT/srv/staging/"*) environment=staging;;
    "$VDS_TEST_ROOT/srv/production/"*) environment=production;;
    *) exit 99;;
  esac
  event="docker:${environment}:$*"
elif [[ "$1" == run ]]; then
  case "$*" in
    *tuttoseriea-staging_default*) environment=staging;;
    *tuttoseriea-production_default*) environment=production;;
    *) exit 99;;
  esac
  case "${*: -1}" in
    scripts/migrate-db.mjs) event="migrate:${environment}";;
    scripts/provision-db-role.mjs) event="provision:${environment}";;
    *) exit 99;;
  esac
elif [[ "$1" == ps ]]; then
  event=smoke:list
elif [[ "$1" == exec ]]; then
  event=smoke:exec
  cat > "$VDS_TEST_ROOT/smoke.js"
  grep -Fq '"X-Internal-API-Key": key' "$VDS_TEST_ROOT/smoke.js" || exit 99
else
  exit 99
fi
printf '%s\n' "$event" >> "$VDS_TEST_TRACE"
[[ "$event" != "${VDS_FAIL_EVENT:-}" ]] || exit 17
if [[ "$event" == smoke:list ]]; then printf 'fixture-web-container\n'; fi
STUB
cat > "$scratch/bin/sync" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in "$VDS_TEST_ROOT/srv/"*) ;; *) exit 99;; esac
relative="${1#"$VDS_TEST_ROOT/srv/"}"; environment="${relative%%/*}"
if "$VDS_REAL_FLOCK" -n "$VDS_TEST_ROOT/${environment}.lock" true; then
  printf 'State sync executed without the environment lock\n' >&2
  exit 99
fi
if [[ -d "$1" ]]; then
  event="sync-dir:${environment}"
else
  base="${1##*/}"; base="${base#.}"; base="${base%.*}"
  event="sync-file:${environment}:${base}"
fi
printf '%s\n' "$event" >> "$VDS_TEST_TRACE"
[[ "$event" != "${VDS_FAIL_EVENT:-}" ]] || exit 17
if [[ "$event" == sync-dir:production && "${VDS_FAIL_EVENT:-}" == sync-dir:production:after-remove ]] &&
   grep -Fqx 'rm:production:previous-release' "$VDS_TEST_TRACE"; then exit 17; fi
STUB
cat > "$scratch/bin/mv" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
target="${*: -1}"
case "$target" in "$VDS_TEST_ROOT/srv/"*) ;; *) exit 99;; esac
relative="${target#"$VDS_TEST_ROOT/srv/"}"; environment="${relative%%/*}"
event="mv:${environment}:${target##*/}"
printf '%s\n' "$event" >> "$VDS_TEST_TRACE"
[[ "$event" != "${VDS_FAIL_EVENT:-}" ]] || exit 17
"$VDS_REAL_MV" "$@"
STUB
cat > "$scratch/bin/rm" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
target="${*: -1}"
case "$target" in "$VDS_TEST_ROOT/srv/"*) ;; *) exit 99;; esac
if [[ "$target" == */previous-release ]]; then
  printf 'rm:production:previous-release\n' >> "$VDS_TEST_TRACE"
fi
"$VDS_REAL_RM" "$@"
STUB
cat > "$scratch/bin/sudo" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@"
STUB
chmod +x "$scratch/bin/"*
export PATH="${scratch}/bin:${PATH}"
for environment in staging production; do
  : > "$scratch/srv/$environment/config/migration.env"
  : > "$scratch/srv/$environment/config/ai-service.env"
done

sha_a="$(printf 'a%.0s' {1..40})"; web_a="sha256:$(printf 'b%.0s' {1..64})"; ai_a="sha256:$(printf 'c%.0s' {1..64})"
sha_b="$(printf 'd%.0s' {1..40})"; web_b="sha256:$(printf 'e%.0s' {1..64})"; ai_b="sha256:$(printf 'f%.0s' {1..64})"
release_a="${sha_a} ${web_a} ${ai_a}"; release_b="${sha_b} ${web_b} ${ai_b}"
production="$scratch/srv/production/state"
staging="$scratch/srv/staging/state"
reader=tuttoseriea-read-release-state-production
reset_fixture() {
  "$real_rm" -f "$production/"* "$production/".*-release.* "$staging/"* "$staging/".*-release.*
  : > "$VDS_TEST_TRACE"
  VDS_FAIL_EVENT=""
}
write_record() { printf '%s\n' "$2" > "$1"; chmod 600 "$1"; }
run_script() {
  local script="$1"; shift
  status=0
  timeout 10 bash "$scratch/scripts/$script" "$@" > "$scratch/stdout" 2> "$scratch/stderr" || status=$?
  [[ "$status" != 124 && "$status" != 137 ]] || error "Fixture command timed out: $script"
}
expect_ok() {
  run_script "$@"
  [[ "$status" == 0 ]] || { cat "$scratch/stderr" >&2; error "Unexpected failure: $*"; }
}
expect_fail() {
  run_script "$@"
  [[ "$status" != 0 ]] || error "Unexpected success: $*"
}
assert_record() {
  [[ "$(<"$1")" == "$2" ]] || error "Unexpected release record: $1"
  [[ "$(stat -c %a "$1")" == 600 ]] || error "Release record has wrong permissions"
}
assert_trace() {
  [[ "$(<"$VDS_TEST_TRACE")" == "$1" ]] || { cat "$VDS_TEST_TRACE" >&2; error "Unexpected operation order"; }
}

reset_fixture
expect_fail "$reader" unexpected
[[ ! -e "$scratch/production.lock" ]] || error "Reader opened lock before argument validation"
# Absence is independent for each record.
for mask in {0..7}; do
  reset_fixture
  expected=(); index=0
  for label in current verified previous; do
    if (( (mask >> index) & 1 )); then
      write_record "$production/$label-release" "$release_a"
      expected+=("$label $release_a")
    else
      expected+=("$label absent")
    fi
    index=$((index + 1))
  done
  expect_ok "$reader"
  [[ "$(<"$scratch/stdout")" == "$(printf '%s\n' "${expected[@]}")" ]] || error "Reader snapshot differs"
done
[[ -f "$scratch/production.lock" ]] || error "Reader did not create its lock"
for label in current verified previous; do
  for invalid in "" "${sha_a} ${web_a}" "invalid" "${sha_a} bad ${ai_a}" "${sha_a} ${web_a} bad" \
    "${release_a} extra" "${release_a} " "${sha_a}"$'\t'"${web_a} ${ai_a}" \
    "${release_a}"$'\n' "${release_a}"$'\n'"${release_b}"; do
    reset_fixture
    for record in current verified previous; do write_record "$production/$record-release" "$release_a"; done
    write_record "$production/$label-release" "$invalid"
    before="$(sha256sum "$production/"*-release)"
    expect_fail "$reader"
    [[ ! -s "$scratch/stdout" ]] || error "Reader emitted a partial snapshot"
    [[ "$(sha256sum "$production/"*-release)" == "$before" ]] || error "Reader mutated state"
  done
done
reset_fixture
mkdir "$production/verified-release"
expect_fail "$reader"
[[ ! -s "$scratch/stdout" ]] || error "Reader treated non-regular record as absent"
rmdir "$production/verified-release"
ln -s "$production/missing" "$production/verified-release"
expect_fail "$reader"
[[ ! -s "$scratch/stdout" ]] || error "Reader treated broken record as absent"
"$real_rm" -f "$production/verified-release"
write_record "$production/verified-release" "$release_a"
chmod 000 "$production/verified-release"
if [[ ! -r "$production/verified-release" ]]; then
  expect_fail "$reader"
  [[ ! -s "$scratch/stdout" ]] || error "Unreadable reader emitted stdout"
  printf 'vds_reader_unreadable_check=passed\n'
else
  printf 'vds_reader_unreadable_check=not_run_root_can_read\n'
fi
chmod 600 "$production/verified-release"
reset_fixture
write_record "$production/current-release" "$release_a"
write_record "$production/verified-release" "$release_b"
write_record "$production/previous-release" "$release_a"
before="$(sha256sum "$production/"*-release)"
expect_ok "$reader"
[[ "$(sha256sum "$production/"*-release)" == "$before" ]] || error "Reader mutated valid state"
exec 8>"$scratch/production.lock"
"$real_flock" -n 8
expect_fail "$reader"
[[ ! -s "$scratch/stdout" ]] || error "Busy reader emitted stdout"
expect_fail tuttoseriea-read-previous-production
exec 8>&-
expect_ok tuttoseriea-read-previous-production
write_record "$production/previous-release" "${sha_a} ${web_a}"
expect_ok tuttoseriea-read-previous-production
[[ "$(<"$scratch/stdout")" == "${sha_a} ${web_a}" ]] || error "Previous reader lost legacy compatibility"

reset_fixture
expect_ok tuttoseriea-deploy-staging "$sha_a" "$web_a" "$ai_a"
assert_record "$staging/current-release" "$release_a"
[[ ! -e "$staging/verified-release" ]] || error "Deploy verified STAGING"
assert_trace $'docker:staging:config --quiet\ndocker:staging:pull\ndocker:staging:up -d postgres\ndocker:staging:exec -T postgres pg_isready -U tuttoseriea_staging -d tuttoseriea_staging\nmigrate:staging\nprovision:staging\ndocker:staging:up -d --remove-orphans\nsync-file:staging:current-release\nmv:staging:current-release\nsync-dir:staging'
: > "$VDS_TEST_TRACE"
expect_ok tuttoseriea-verify-staging "$sha_a" "$web_a" "$ai_a"
assert_record "$staging/verified-release" "$release_a"
assert_trace $'sync-file:staging:verified-release\nmv:staging:verified-release\nsync-dir:staging'
write_record "$staging/current-release" "${sha_a} ${web_a}"
expect_ok tuttoseriea-verify-staging "$sha_a" "$web_a"
assert_record "$staging/verified-release" "${sha_a} ${web_a}"
expect_fail tuttoseriea-deploy-staging "$sha_a" "$web_a"

reset_fixture
write_record "$staging/verified-release" "$release_a"
expect_ok tuttoseriea-deploy-production "$sha_a" "$web_a" "$ai_a"
assert_record "$production/current-release" "$release_a"
[[ ! -e "$production/verified-release" && ! -e "$production/previous-release" ]] || error "First deploy wrote extra state"
assert_trace $'docker:production:config --quiet\ndocker:production:pull\ndocker:production:up -d postgres\ndocker:production:exec -T postgres pg_isready -U tuttoseriea_production -d tuttoseriea_production\nmigrate:production\nprovision:production\ndocker:production:up -d --remove-orphans\nsync-file:production:current-release\nmv:production:current-release\nsync-dir:production'
: > "$VDS_TEST_TRACE"
expect_ok tuttoseriea-verify-production "$sha_a" "$web_a" "$ai_a"
assert_record "$production/verified-release" "$release_a"
assert_trace $'smoke:list\nsmoke:exec\nsync-file:production:verified-release\nmv:production:verified-release\nsync-dir:production'
: > "$VDS_TEST_TRACE"
expect_ok tuttoseriea-verify-production "$sha_a" "$web_a" "$ai_a"
assert_trace $'smoke:list\nsmoke:exec'
expect_fail tuttoseriea-deploy-production "$sha_a" "$web_a" "$ai_a"
write_record "$staging/verified-release" "$release_b"
: > "$VDS_TEST_TRACE"
expect_ok tuttoseriea-deploy-production "$sha_b" "$web_b" "$ai_b"
assert_record "$production/current-release" "$release_b"
assert_record "$production/previous-release" "$release_a"
assert_record "$production/verified-release" "$release_a"
[[ "$(tail -n 6 "$VDS_TEST_TRACE")" == $'sync-file:production:previous-release\nmv:production:previous-release\nsync-dir:production\nsync-file:production:current-release\nmv:production:current-release\nsync-dir:production' ]] || error "Previous/current write order changed"
expect_fail tuttoseriea-deploy-production "$sha_b" "$web_b" "$ai_b"
: > "$VDS_TEST_TRACE"
expect_fail tuttoseriea-rollback-production "$sha_a" "$web_a"
[[ ! -s "$VDS_TEST_TRACE" ]] || error "Legacy rollback changed runtime"
expect_ok tuttoseriea-rollback-production "$sha_a" "$web_a" "$ai_a"
assert_record "$production/current-release" "$release_a"
assert_record "$production/verified-release" "$release_a"
assert_record "$production/previous-release" "$release_a"
assert_trace $'docker:production:config --quiet\ndocker:production:pull\ndocker:production:up -d --remove-orphans\nsync-file:production:current-release\nmv:production:current-release\nsync-dir:production'
: > "$VDS_TEST_TRACE"
expect_ok tuttoseriea-verify-production "$sha_a" "$web_a" "$ai_a"
[[ ! -e "$production/previous-release" ]] || error "Rollback verification retained previous"
assert_trace $'smoke:list\nsmoke:exec\nsync-file:production:verified-release\nmv:production:verified-release\nsync-dir:production\nrm:production:previous-release\nsync-dir:production'

reset_fixture
write_record "$production/current-release" "${sha_a} ${web_a}"
expect_ok tuttoseriea-verify-production "$sha_a" "$web_a"
assert_record "$production/verified-release" "${sha_a} ${web_a}"
assert_trace $'sync-file:production:verified-release\nmv:production:verified-release\nsync-dir:production'
for environment in staging production; do
  for failure in "sync-file:${environment}:verified-release" "mv:${environment}:verified-release" "sync-dir:${environment}"; do
    reset_fixture
    state="$scratch/srv/$environment/state"
    write_record "$state/current-release" "$release_b"
    write_record "$state/verified-release" "$release_a"
    VDS_FAIL_EVENT="$failure"
    expect_fail "tuttoseriea-verify-${environment}" "$sha_b" "$web_b" "$ai_b"
    [[ "$(<"$scratch/stdout")" != *"Verified release recorded."* ]] || error "Failed durability reported success"
    if [[ "$failure" == sync-dir:* ]]; then assert_record "$state/verified-release" "$release_b"; else assert_record "$state/verified-release" "$release_a"; fi
  done
done
for script in deploy-staging deploy-production rollback-production; do
  reset_fixture
  write_record "$staging/verified-release" "$release_b"
  write_record "$production/current-release" "$release_a"
  write_record "$production/verified-release" "$release_a"
  write_record "$production/previous-release" "$release_b"
  write_record "$staging/current-release" "$release_a"
  environment=production; [[ "$script" != deploy-staging ]] || environment=staging
  VDS_FAIL_EVENT="docker:${environment}:up -d --remove-orphans"
  expect_fail "tuttoseriea-${script}" "$sha_b" "$web_b" "$ai_b"
  assert_record "$scratch/srv/$environment/state/current-release" "$release_a"
  [[ "$(<"$VDS_TEST_TRACE")" != *"sync-file:"* ]] || error "Compose failure wrote state"
done
reset_fixture
write_record "$production/current-release" "$release_a"
write_record "$production/previous-release" "$release_a"
write_record "$production/verified-release" "$release_b"
VDS_FAIL_EVENT=sync-dir:production
expect_fail tuttoseriea-verify-production "$sha_a" "$web_a" "$ai_a"
[[ -f "$production/previous-release" ]] || error "Failed verified durability deleted previous"
[[ "$(<"$scratch/stdout")" != *"rollback release verified."* ]] || error "Failed rollback durability reported success"

reset_fixture
write_record "$production/current-release" "$release_a"
write_record "$production/previous-release" "$release_a"
write_record "$production/verified-release" "$release_b"
VDS_FAIL_EVENT=sync-dir:production:after-remove
expect_fail tuttoseriea-verify-production "$sha_a" "$web_a" "$ai_a"
assert_record "$production/verified-release" "$release_a"
[[ ! -e "$production/previous-release" ]] || error "Removal durability failure changed rollback transition"
[[ "$(<"$scratch/stdout")" != *"rollback release verified."* ]] || error "Removal durability failure reported success"
[[ "$(tail -n 2 "$VDS_TEST_TRACE")" == $'rm:production:previous-release\nsync-dir:production' ]] || error "Removal was not followed by directory sync"
for script in deploy-staging deploy-production rollback-production; do
  reset_fixture
  write_record "$staging/verified-release" "$release_b"
  write_record "$production/current-release" "$release_a"
  write_record "$production/verified-release" "$release_a"
  write_record "$production/previous-release" "$release_b"
  write_record "$staging/current-release" "$release_a"
  environment=production; [[ "$script" != deploy-staging ]] || environment=staging
  VDS_FAIL_EVENT="sync-dir:${environment}"
  expect_fail "tuttoseriea-${script}" "$sha_b" "$web_b" "$ai_b"
  [[ "$(<"$scratch/stdout")" != *"Current release recorded."* ]] || error "Writer directory sync failure reported success"
done
reset_fixture
write_record "$staging/verified-release" "$release_a"
expect_fail tuttoseriea-deploy-production "$sha_b" "$web_b" "$ai_b"
[[ ! -s "$VDS_TEST_TRACE" ]] || error "Unapproved tuple reached Docker"
write_record "$staging/verified-release" "$release_b"
write_record "$production/previous-release" "$release_a"
expect_fail tuttoseriea-deploy-production "$sha_b" "$web_b" "$ai_b"
[[ ! -s "$VDS_TEST_TRACE" ]] || error "Inconsistent bootstrap reached Docker"
write_record "$production/current-release" "$release_a"
write_record "$production/verified-release" "$release_a"
VDS_FAIL_EVENT=smoke:exec
expect_fail tuttoseriea-verify-production "$sha_a" "$web_a" "$ai_a"
assert_record "$production/verified-release" "$release_a"
[[ "$(<"$VDS_TEST_TRACE")" != *"sync-file:"* ]] || error "Failed internal smoke wrote state"
reset_fixture
write_record "$staging/verified-release" "$release_b"
write_record "$production/current-release" "$release_a"
write_record "$production/verified-release" "$release_a"
write_record "$production/previous-release" "$release_b"
exec 8>"$scratch/production.lock"
"$real_flock" -n 8
expect_fail tuttoseriea-deploy-production "$sha_b" "$web_b" "$ai_b"
expect_fail tuttoseriea-verify-production "$sha_a" "$web_a" "$ai_a"
expect_fail tuttoseriea-rollback-production "$sha_b" "$web_b" "$ai_b"
[[ ! -s "$VDS_TEST_TRACE" ]] || error "Busy production writer reached Docker or state"
exec 8>&-
write_record "$staging/current-release" "$release_a"
exec 8>"$scratch/staging.lock"
"$real_flock" -n 8
expect_fail tuttoseriea-deploy-staging "$sha_a" "$web_a" "$ai_a"
expect_fail tuttoseriea-verify-staging "$sha_a" "$web_a" "$ai_a"
[[ ! -s "$VDS_TEST_TRACE" ]] || error "Busy STAGING writer reached Docker or state"
exec 8>&-
VDS_FAIL_EVENT=""
SSH_ORIGINAL_COMMAND="previous-release" expect_ok tuttoseriea-ssh-production
[[ "$(<"$scratch/stdout")" == $'-n\n/usr/local/sbin/tuttoseriea-read-previous-production' ]] || error "Previous SSH route changed"
for action in deploy verify rollback; do
  SSH_ORIGINAL_COMMAND="${action} ${release_a}" expect_ok tuttoseriea-ssh-production
  [[ "$(<"$scratch/stdout")" == "$(printf '%s\n' -n "/usr/local/sbin/tuttoseriea-${action}-production" "$sha_a" "$web_a" "$ai_a")" ]] || error "Production SSH route changed"
  SSH_ORIGINAL_COMMAND="${action} ${sha_a} ${web_a}" expect_ok tuttoseriea-ssh-production
done
for forbidden in "" "previous-release extra" "release-state" "read-release-state-production" "run-job football.sync-serie-a-foundation" "deploy ${release_a};uname"; do
  SSH_ORIGINAL_COMMAND="$forbidden" expect_fail tuttoseriea-ssh-production
done
if grep -Eq 'read-release-state-production|/usr/bin/docker' "$VDS_DIR/tuttoseriea-deploy.sudoers" "$VDS_DIR/tuttoseriea-ssh-production"; then error "Production restricted interface broadened"; fi
if grep -Eq 'docker[[:space:]]+(system|image|container|volume|builder)[[:space:]]+prune' "$VDS_DIR"/tuttoseriea-*; then error "Broad Docker prune was introduced"; fi
printf 'vds_shell_behavior_check=passed\n'
printf 'vds_reader_snapshot_check=passed\n'
printf 'vds_real_flock_check=passed\n'
printf 'vds_state_durability_order_check=passed\n'
printf 'vds_release_transition_check=passed\n'
printf 'vds_production_forced_command_check=passed\n'
