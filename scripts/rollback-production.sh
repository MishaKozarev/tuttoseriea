#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-release.sh
source "${SCRIPT_DIR}/lib-release.sh"

wait_for_http_smoke() {
  printf 'Waiting for PRODUCTION HTTP availability at %s.\n' "$PRODUCTION_URL"

  for attempt in {1..30}; do
    if curl --fail --silent --show-error --location --max-time 10 "$PRODUCTION_URL" --output /dev/null; then
      break
    fi

    if [[ "$attempt" == "30" ]]; then
      error "PRODUCTION did not become HTTP-available at ${PRODUCTION_URL}"
    fi

    sleep 5
  done

  curl --fail --silent --show-error --location --max-time 10 "$PRODUCTION_URL" --output "$smoke_body_file"

  if [[ ! -s "$smoke_body_file" ]]; then
    error "PRODUCTION smoke response body is empty"
  fi
}

require_env PRODUCTION_SSH_HOST
require_env PRODUCTION_SSH_KNOWN_HOSTS
require_env PRODUCTION_SSH_PRIVATE_KEY

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  error "Rollback Production must run from refs/heads/main"
fi

WEB_IMAGE="${WEB_IMAGE:-ghcr.io/mishakozarev/tuttoseriea/web}"
AI_SERVICE_IMAGE="${AI_SERVICE_IMAGE:-ghcr.io/mishakozarev/tuttoseriea/ai-service}"
PRODUCTION_URL="${PRODUCTION_URL:-https://tuttoseriea.com/}"
PRODUCTION_SSH_PORT="${PRODUCTION_SSH_PORT:-56777}"
PRODUCTION_SSH_USER="${PRODUCTION_SSH_USER:-deploy}"

key_file="$(mktemp)"
known_hosts_file="$(mktemp)"
smoke_body_file="$(mktemp)"

cleanup() {
  rm -f "$key_file" "$known_hosts_file" "$smoke_body_file"
}

trap cleanup EXIT

printf '%s\n' "$PRODUCTION_SSH_PRIVATE_KEY" > "$key_file"
chmod 600 "$key_file"

printf '%s\n' "$PRODUCTION_SSH_KNOWN_HOSTS" > "$known_hosts_file"
chmod 600 "$known_hosts_file"

ssh_options=(
  -i "$key_file"
  -p "$PRODUCTION_SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout=20
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$known_hosts_file"
)

printf 'Reading trusted PRODUCTION previous-release through the documented VDS contract.\n'

previous_release="$(
  ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" previous-release
)"

rollback_tuple="$(parse_three_field_release "$previous_release" "PRODUCTION previous-release")"
read -r rollback_git_sha rollback_web_image_digest rollback_ai_service_image_digest <<< "$rollback_tuple"

fetch_main_history
validate_main_ancestor "$rollback_git_sha" "Rollback Git SHA"
validate_release_digests "$rollback_git_sha" "$WEB_IMAGE" "$rollback_web_image_digest" "$AI_SERVICE_IMAGE" "$rollback_ai_service_image_digest"

web_image_tag="$(image_tag_for_sha "$WEB_IMAGE" "$rollback_git_sha")"
ai_service_image_tag="$(image_tag_for_sha "$AI_SERVICE_IMAGE" "$rollback_git_sha")"

printf 'Validated trusted previous-release target %s %s %s.\n' "$rollback_git_sha" "$rollback_web_image_digest" "$rollback_ai_service_image_digest"
printf 'Rolling back PRODUCTION through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" rollback "$rollback_git_sha" "$rollback_web_image_digest" "$rollback_ai_service_image_digest"

wait_for_http_smoke

printf 'PRODUCTION rollback health and smoke checks passed.\n'
printf 'Recording verified PRODUCTION rollback release through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" verify "$rollback_git_sha" "$rollback_web_image_digest" "$rollback_ai_service_image_digest"

printf 'PRODUCTION rollback release verified.\n'

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### PRODUCTION rollback\n\n'
    printf '| Field | Value |\n'
    printf '| --- | --- |\n'
    printf '| Git SHA | `%s` |\n' "$rollback_git_sha"
    printf '| Web image tag | `%s` |\n' "$web_image_tag"
    printf '| Web image digest | `%s` |\n' "$rollback_web_image_digest"
    printf '| AI service image tag | `%s` |\n' "$ai_service_image_tag"
    printf '| AI service image digest | `%s` |\n' "$rollback_ai_service_image_digest"
    printf '| Production URL | <%s> |\n' "$PRODUCTION_URL"
    printf '| VDS previous-release command | `previous-release` |\n'
    printf '| VDS rollback command | `rollback %s %s %s` |\n' "$rollback_git_sha" "$rollback_web_image_digest" "$rollback_ai_service_image_digest"
    printf '| VDS verify command | `verify %s %s %s` |\n' "$rollback_git_sha" "$rollback_web_image_digest" "$rollback_ai_service_image_digest"
    printf '| Health/smoke | passed |\n'
    printf '| Verified release | recorded |\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
