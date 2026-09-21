#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib-release.sh
source "${SCRIPT_DIR}/lib-release.sh"

require_env VERIFY_GIT_SHA
require_env VERIFY_WEB_IMAGE_DIGEST
require_env VERIFY_AI_SERVICE_IMAGE_DIGEST
require_env STAGING_SSH_HOST
require_env STAGING_SSH_KNOWN_HOSTS
require_env STAGING_SSH_PRIVATE_KEY

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  error "Verify Staging must run from refs/heads/main"
fi

WEB_IMAGE="${WEB_IMAGE:-ghcr.io/mishakozarev/tuttoseriea/web}"
AI_SERVICE_IMAGE="${AI_SERVICE_IMAGE:-ghcr.io/mishakozarev/tuttoseriea/ai-service}"
STAGING_SSH_PORT="${STAGING_SSH_PORT:-56777}"
STAGING_SSH_USER="${STAGING_SSH_USER:-deploy}"

git_sha="$(to_lower "$VERIFY_GIT_SHA")"
web_image_digest="$(to_lower "$VERIFY_WEB_IMAGE_DIGEST")"
ai_service_image_digest="$(to_lower "$VERIFY_AI_SERVICE_IMAGE_DIGEST")"

if ! validate_git_sha "$git_sha"; then
  error "VERIFY_GIT_SHA must be a 40-character commit SHA"
fi

if ! validate_image_digest "$web_image_digest"; then
  error "VERIFY_WEB_IMAGE_DIGEST must use the sha256:<64-hex> format"
fi

if ! validate_image_digest "$ai_service_image_digest"; then
  error "VERIFY_AI_SERVICE_IMAGE_DIGEST must use the sha256:<64-hex> format"
fi

fetch_main_history
validate_main_ancestor "$git_sha" "VERIFY_GIT_SHA"
validate_release_digests "$git_sha" "$WEB_IMAGE" "$web_image_digest" "$AI_SERVICE_IMAGE" "$ai_service_image_digest"

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

web_image_tag="$(image_tag_for_sha "$WEB_IMAGE" "$git_sha")"
ai_service_image_tag="$(image_tag_for_sha "$AI_SERVICE_IMAGE" "$git_sha")"

printf 'Validated %s as an ancestor of origin/main.\n' "$git_sha"
printf 'Validated %s resolves to %s.\n' "$web_image_tag" "$web_image_digest"
printf 'Validated %s resolves to %s.\n' "$ai_service_image_tag" "$ai_service_image_digest"
printf 'Recording verified STAGING release through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${STAGING_SSH_USER}@${STAGING_SSH_HOST}" verify "$git_sha" "$web_image_digest" "$ai_service_image_digest"

printf 'STAGING release verified.\n'

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### STAGING verification\n\n'
    printf '| Field | Value |\n'
    printf '| --- | --- |\n'
    printf '| Git SHA | `%s` |\n' "$git_sha"
    printf '| Web image tag | `%s` |\n' "$web_image_tag"
    printf '| Web image digest | `%s` |\n' "$web_image_digest"
    printf '| AI service image tag | `%s` |\n' "$ai_service_image_tag"
    printf '| AI service image digest | `%s` |\n' "$ai_service_image_digest"
    printf '| VDS verify command | `verify %s %s %s` |\n' "$git_sha" "$web_image_digest" "$ai_service_image_digest"
    printf '| Verified release | recorded |\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
