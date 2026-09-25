#!/usr/bin/env bash
set -Eeuo pipefail

error() {
  printf '%s\n' "$*" >&2
  exit 1
}

validate_git_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

validate_image_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
}

require_file() {
  local path="$1"
  local label="$2"

  if [[ ! -f "$path" ]]; then
    error "Missing ${label}: ${path}"
  fi
}

read_current_release() {
  if [[ "$#" -ne 1 ]]; then
    error "Usage: read_current_release <environment>"
  fi

  local environment="$1"

  case "$environment" in
    staging)
      /usr/local/sbin/tuttoseriea-read-current-staging
      ;;
    *)
      error "No current-release reader configured for environment: ${environment}"
      ;;
  esac
}

validate_job_type() {
  case "$1" in
    football.sync-serie-a-foundation)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

run_tuttoseriea_job() {
  if [[ "$#" -ne 3 ]]; then
    error "Usage: run_tuttoseriea_job <environment> <compose-project> <job-type>"
  fi

  local environment="$1"
  local compose_project="$2"
  local job_type="$3"

  if ! validate_job_type "$job_type"; then
    error "Unsupported job type: ${job_type}"
  fi

  local base_dir="/srv/tuttoseriea/${environment}"
  local config_dir="${base_dir}/config"
  local runtime_env="${config_dir}/runtime.env"
  local runner_env="${config_dir}/job-runner.env"
  local web_image="ghcr.io/mishakozarev/tuttoseriea/web"

  require_file "$runtime_env" "web runtime env file"
  require_file "$runner_env" "job runner env file"

  local release_record
  release_record="$(read_current_release "$environment")"

  if [[ "$release_record" == *$'\n'* ]]; then
    error "current-release must contain a single release tuple"
  fi

  local git_sha
  local web_digest
  local ai_service_digest
  local extra

  read -r git_sha web_digest ai_service_digest extra <<< "$release_record"

  if [[ -z "${git_sha:-}" || -z "${web_digest:-}" || -z "${ai_service_digest:-}" || -n "${extra:-}" ]]; then
    error "current-release must contain exactly: <GIT_SHA> <WEB_IMAGE_DIGEST> <AI_SERVICE_IMAGE_DIGEST>"
  fi

  git_sha="${git_sha,,}"
  web_digest="${web_digest,,}"
  ai_service_digest="${ai_service_digest,,}"

  validate_git_sha "$git_sha" || error "current-release has invalid Git SHA"
  validate_image_digest "$web_digest" || error "current-release has invalid Web image digest"
  validate_image_digest "$ai_service_digest" || error "current-release has invalid AI service image digest"

  local network="${compose_project}_default"
  local image_ref="${web_image}@${web_digest}"

  printf 'run_job_environment=%s\n' "$environment"
  printf 'run_job_type=%s\n' "$job_type"
  printf 'run_job_git_sha=%s\n' "$git_sha"
  printf 'run_job_web_image=%s\n' "$image_ref"

  docker run \
    --rm \
    --pull never \
    --network "$network" \
    --env-file "$runtime_env" \
    --env-file "$runner_env" \
    "$image_ref" \
    node /app/job-runner/cli.js --type "$job_type"
}
