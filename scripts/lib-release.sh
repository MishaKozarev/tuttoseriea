#!/usr/bin/env bash

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

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

validate_git_sha() {
  local value="$1"

  [[ "$value" =~ ^[0-9a-f]{40}$ ]]
}

validate_image_digest() {
  local value="$1"

  [[ "$value" =~ ^sha256:[0-9a-f]{64}$ ]]
}

image_tag_for_sha() {
  local image="$1"
  local git_sha="$2"

  printf '%s:sha-%s' "$image" "$git_sha"
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
  local env_name="$2"

  if ! git cat-file -e "${git_sha}^{commit}"; then
    error "${env_name} does not identify a commit in the fetched repository history"
  fi

  if ! git merge-base --is-ancestor "$git_sha" refs/remotes/origin/main; then
    error "${env_name} must be an ancestor of current origin/main"
  fi
}

validate_published_digest() {
  local image_tag="$1"
  local expected_digest="$2"
  local label="$3"

  local inspect_output
  inspect_output="$(docker buildx imagetools inspect "$image_tag")" ||
    error "Failed to inspect GHCR image tag: ${image_tag}"

  local published_digest
  published_digest="$(printf '%s\n' "$inspect_output" | awk '$1 == "Digest:" { print $2; exit }' | tr '[:upper:]' '[:lower:]')"

  if [[ -z "$published_digest" ]]; then
    error "Could not determine published digest for ${image_tag}"
  fi

  if [[ "$published_digest" != "$expected_digest" ]]; then
    error "Provided ${label} digest does not match ${image_tag}; expected ${published_digest}, got ${expected_digest}"
  fi
}

validate_release_digests() {
  local git_sha="$1"
  local web_image="$2"
  local web_digest="$3"
  local ai_service_image="$4"
  local ai_service_digest="$5"

  validate_published_digest "$(image_tag_for_sha "$web_image" "$git_sha")" "$web_digest" "web image"
  validate_published_digest "$(image_tag_for_sha "$ai_service_image" "$git_sha")" "$ai_service_digest" "AI service image"
}

parse_three_field_release() {
  local release_record="$1"
  local context="$2"

  if [[ "$release_record" == *$'\n'* ]]; then
    error "${context} returned multiple lines"
  fi

  local git_sha
  local web_digest
  local ai_service_digest
  local extra

  read -r git_sha web_digest ai_service_digest extra <<< "$release_record"

  if [[ -z "${git_sha:-}" || -z "${web_digest:-}" || -z "${ai_service_digest:-}" || -n "${extra:-}" ]]; then
    error "${context} must return exactly: <GIT_SHA> <WEB_IMAGE_DIGEST> <AI_SERVICE_IMAGE_DIGEST>"
  fi

  git_sha="$(to_lower "$git_sha")"
  web_digest="$(to_lower "$web_digest")"
  ai_service_digest="$(to_lower "$ai_service_digest")"

  if ! validate_git_sha "$git_sha"; then
    error "${context} returned an invalid Git SHA"
  fi

  if ! validate_image_digest "$web_digest"; then
    error "${context} returned an invalid web image digest"
  fi

  if ! validate_image_digest "$ai_service_digest"; then
    error "${context} returned an invalid AI service image digest"
  fi

  printf '%s %s %s\n' "$git_sha" "$web_digest" "$ai_service_digest"
}
