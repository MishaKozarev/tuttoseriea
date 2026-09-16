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
    error "DEPLOY_GIT_SHA does not identify a commit in the fetched repository history"
  fi

  if ! git merge-base --is-ancestor "$git_sha" refs/remotes/origin/main; then
    error "DEPLOY_GIT_SHA must be an ancestor of current origin/main"
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
    error "Provided image digest does not match ${image_tag}; expected ${published_digest}, got ${image_digest}"
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

require_env DEPLOY_GIT_SHA
require_env DEPLOY_IMAGE_DIGEST
require_env PRODUCTION_SSH_HOST
require_env PRODUCTION_SSH_KNOWN_HOSTS
require_env PRODUCTION_SSH_PRIVATE_KEY

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  error "Deploy Production must run from refs/heads/main"
fi

WEB_IMAGE="${WEB_IMAGE:-ghcr.io/mishakozarev/tuttoseriea/web}"
PRODUCTION_URL="${PRODUCTION_URL:-https://tuttoseriea.com/}"
PRODUCTION_SSH_PORT="${PRODUCTION_SSH_PORT:-56777}"
PRODUCTION_SSH_USER="${PRODUCTION_SSH_USER:-deploy}"

git_sha="$(printf '%s' "$DEPLOY_GIT_SHA" | tr '[:upper:]' '[:lower:]')"
image_digest="$(printf '%s' "$DEPLOY_IMAGE_DIGEST" | tr '[:upper:]' '[:lower:]')"

if ! validate_git_sha "$git_sha"; then
  error "DEPLOY_GIT_SHA must be a 40-character commit SHA"
fi

if ! validate_image_digest "$image_digest"; then
  error "DEPLOY_IMAGE_DIGEST must use the sha256:<64-hex> format"
fi

fetch_main_history
validate_main_ancestor "$git_sha"
validate_ghcr_digest "$git_sha" "$image_digest"

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

image_tag="${WEB_IMAGE}:sha-${git_sha}"

printf 'Validated %s as an ancestor of origin/main.\n' "$git_sha"
printf 'Validated %s resolves to %s.\n' "$image_tag" "$image_digest"
printf 'Deploying PRODUCTION through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" deploy "$git_sha" "$image_digest"

wait_for_http_smoke

printf 'PRODUCTION health and smoke checks passed.\n'
printf 'Recording verified PRODUCTION release through the documented VDS contract.\n'

ssh "${ssh_options[@]}" "${PRODUCTION_SSH_USER}@${PRODUCTION_SSH_HOST}" verify "$git_sha" "$image_digest"

printf 'PRODUCTION release verified.\n'

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### PRODUCTION deployment\n\n'
    printf '| Field | Value |\n'
    printf '| --- | --- |\n'
    printf '| Git SHA | `%s` |\n' "$git_sha"
    printf '| Image tag | `%s` |\n' "$image_tag"
    printf '| Image digest | `%s` |\n' "$image_digest"
    printf '| Production URL | <%s> |\n' "$PRODUCTION_URL"
    printf '| VDS deploy command | `deploy %s %s` |\n' "$git_sha" "$image_digest"
    printf '| VDS verify command | `verify %s %s` |\n' "$git_sha" "$image_digest"
    printf '| Health/smoke | passed |\n'
    printf '| Verified release | recorded |\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
