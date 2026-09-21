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

require_env DEPLOY_GIT_SHA
require_env DEPLOY_WEB_IMAGE_DIGEST
require_env DEPLOY_AI_SERVICE_IMAGE_DIGEST
require_env PRODUCTION_SSH_HOST
require_env PRODUCTION_SSH_KNOWN_HOSTS
require_env PRODUCTION_SSH_PRIVATE_KEY

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  error "Deploy Production must run from refs/heads/main"
fi

WEB_IMAGE="${WEB_IMAGE:-ghcr.io/mishakozarev/tuttoseriea/web}"
AI_SERVICE_IMAGE="${AI_SERVICE_IMAGE:-ghcr.io/mishakozarev/tuttoseriea/ai-service}"
PRODUCTION_URL="${PRODUCTION_URL:-https://tuttoseriea.com/}"
PRODUCTION_SSH_PORT="${PRODUCTION_SSH_PORT:-56777}"
PRODUCTION_SSH_USER="${PRODUCTION_SSH_USER:-deploy}"

git_sha="$(to_lower "$DEPLOY_GIT_SHA")"
web_image_digest="$(to_lower "$DEPLOY_WEB_IMAGE_DIGEST")"
ai_service_image_digest="$(to_lower "$DEPLOY_AI_SERVICE_IMAGE_DIGEST")"

if ! validate_git_sha "$git_sha"; then
  error "DEPLOY_GIT_SHA must be a 40-character commit SHA"
fi

if ! validate_image_digest "$web_image_digest"; then
  error "DEPLOY_WEB_IMAGE_DIGEST must use the sha256:<64-hex> format"
fi

if ! validate_image_digest "$ai_service_image_digest"; then
  error "DEPLOY_AI_SERVICE_IMAGE_DIGEST must use the sha256:<64-hex> format"
fi

fetch_main_history
validate_main_ancestor "$git_sha" "DEPLOY_GIT_SHA"
validate_release_digests "$git_sha" "$WEB_IMAGE" "$web_image_digest" "$AI_SERVICE_IMAGE" "$ai_service_image_digest"

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

web_image_tag="$(image_tag_for_sha "$WEB_IMAGE" "$git_sha")"
ai_service_image_tag="$(image_tag_for_sha "$AI_SERVICE_IMAGE" "$git_sha")"

printf 'Validated %s as an ancestor of origin/main.\n' "$git_sha"
printf 'Validated %s resolves to %s.\n' "$web_image_tag" "$web_image_digest"
printf 'Validated %s resolves to %s.\n' "$ai_service_image_tag" "$ai_service_image_digest"
printf 'Deploying PRODUCTION through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" deploy "$git_sha" "$web_image_digest" "$ai_service_image_digest"

wait_for_http_smoke

printf 'PRODUCTION health and smoke checks passed.\n'
printf 'Recording verified PRODUCTION release through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" verify "$git_sha" "$web_image_digest" "$ai_service_image_digest"

printf 'PRODUCTION release verified.\n'

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### PRODUCTION deployment\n\n'
    printf '| Field | Value |\n'
    printf '| --- | --- |\n'
    printf '| Git SHA | `%s` |\n' "$git_sha"
    printf '| Web image tag | `%s` |\n' "$web_image_tag"
    printf '| Web image digest | `%s` |\n' "$web_image_digest"
    printf '| AI service image tag | `%s` |\n' "$ai_service_image_tag"
    printf '| AI service image digest | `%s` |\n' "$ai_service_image_digest"
    printf '| Production URL | <%s> |\n' "$PRODUCTION_URL"
    printf '| VDS deploy command | `deploy %s %s %s` |\n' "$git_sha" "$web_image_digest" "$ai_service_image_digest"
    printf '| VDS verify command | `verify %s %s %s` |\n' "$git_sha" "$web_image_digest" "$ai_service_image_digest"
    printf '| Health/smoke | passed |\n'
    printf '| Verified release | recorded |\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
