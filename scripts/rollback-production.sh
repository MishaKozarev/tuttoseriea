#!/usr/bin/env bash
set -Eeuo pipefail

error() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

require_env() {
  local name="$1"

  if [[ -z "${!name:-}" ]]; then
    error "Missing required environment variable: ${name}"
  fi
}

validate_git_sha() {
  local value="$1"

  [[ "$value" =~ ^[0-9a-f]{40}$ ]]
}

validate_image_digest() {
  local value="$1"

  [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]]
}

fetch_main_history() {
  if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
    git fetch --no-tags --prune --unshallow origin +refs/heads/main:refs/remotes/origin/main
  else
    git fetch --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main
  fi

  if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
    error "Repository checkout is shallow; cannot reliably validate commit ancestry"
  fi
}

validate_main_ancestor() {
  local git_sha="$1"

  if ! git cat-file -e "${git_sha}^{commit}"; then
    error "Rollback Git SHA does not identify a commit in the fetched repository history"
  fi

  if ! git merge-base --is-ancestor "$git_sha" refs/remotes/origin/main; then
    error "Rollback Git SHA must be an ancestor of current origin/main"
  fi
}

validate_ghcr_digest() {
  local git_sha="$1"
  local image_digest="$2"
  local image_tag="${WEB_IMAGE}:sha-${git_sha}"

  inspect_output="$(docker buildx imagetools inspect "$image_tag")" ||
    error "Failed to inspect GHCR image tag: ${image_tag}"

  published_digest="$(printf '%s\n' "$inspect_output" | awk '$1 == "Digest:" { print $2; exit }' | tr '[:upper:]' '[:lower:]')"

  if [[ -z "$published_digest" ]]; then
    error "Could not determine published digest for ${image_tag}"
  fi

  if [[ "$published_digest" != "$image_digest" ]]; then
    error "Rollback image digest does not match ${image_tag}; expected ${published_digest}, got ${image_digest}"
  fi
}

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

if [[ "$previous_release" == *$'\n'* ]]; then
  error "PRODUCTION previous-release returned multiple lines"
fi

read -r rollback_git_sha rollback_image_digest extra <<< "$previous_release"

if [[ -z "${rollback_git_sha:-}" || -z "${rollback_image_digest:-}" || -n "${extra:-}" ]]; then
  error "PRODUCTION previous-release must return exactly: <GIT_SHA> <IMAGE_DIGEST>"
fi

rollback_git_sha="$(printf '%s' "$rollback_git_sha" | tr '[:upper:]' '[:lower:]')"
rollback_image_digest="$(printf '%s' "$rollback_image_digest" | tr '[:upper:]' '[:lower:]')"

if ! validate_git_sha "$rollback_git_sha"; then
  error "PRODUCTION previous-release returned an invalid Git SHA"
fi

if ! validate_image_digest "$rollback_image_digest"; then
  error "PRODUCTION previous-release returned an invalid image digest"
fi

fetch_main_history
validate_main_ancestor "$rollback_git_sha"
validate_ghcr_digest "$rollback_git_sha" "$rollback_image_digest"

image_tag="${WEB_IMAGE}:sha-${rollback_git_sha}"

printf 'Validated trusted previous-release target %s %s.\n' "$rollback_git_sha" "$rollback_image_digest"
printf 'Rolling back PRODUCTION through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" rollback "$rollback_git_sha" "$rollback_image_digest"

wait_for_http_smoke

printf 'PRODUCTION rollback health and smoke checks passed.\n'
printf 'Recording verified PRODUCTION rollback release through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" verify "$rollback_git_sha" "$rollback_image_digest"

printf 'PRODUCTION rollback release verified.\n'

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### PRODUCTION rollback\n\n'
    printf '| Field | Value |\n'
    printf '| --- | --- |\n'
    printf '| Git SHA | `%s` |\n' "$rollback_git_sha"
    printf '| Image tag | `%s` |\n' "$image_tag"
    printf '| Image digest | `%s` |\n' "$rollback_image_digest"
    printf '| Production URL | <%s> |\n' "$PRODUCTION_URL"
    printf '| VDS previous-release command | `previous-release` |\n'
    printf '| VDS rollback command | `rollback %s %s` |\n' "$rollback_git_sha" "$rollback_image_digest"
    printf '| VDS verify command | `verify %s %s` |\n' "$rollback_git_sha" "$rollback_image_digest"
    printf '| Health/smoke | passed |\n'
    printf '| Verified release | recorded |\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
