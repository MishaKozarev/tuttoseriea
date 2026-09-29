#!/usr/bin/env bash

RUN_JOB_STAGING_ALLOWED_TYPES=(
  "football.sync-serie-a-foundation"
  "football.sync-serie-a-matches"
  "football.sync-serie-a-standings"
  "football.sync-serie-a-squads"
  "football.sync-serie-a-player-statistics"
)

RUN_JOB_PRODUCTION_ALLOWED_TYPES=(
  "football.sync-serie-a-foundation"
)

validate_run_job_type_for_environment() {
  local environment="$1"
  local job_type="$2"

  local allowed_types=()

  case "$environment" in
    staging)
      allowed_types=("${RUN_JOB_STAGING_ALLOWED_TYPES[@]}")
      ;;
    production)
      allowed_types=("${RUN_JOB_PRODUCTION_ALLOWED_TYPES[@]}")
      ;;
    *)
      return 1
      ;;
  esac

  for allowed_type in "${allowed_types[@]}"; do
    if [[ "$job_type" == "$allowed_type" ]]; then
      return 0
    fi
  done

  return 1
}

validate_run_job_type() {
  local job_type="$1"

  validate_run_job_type_for_environment production "$job_type"
}

require_run_job_type_for_environment() {
  local environment="$1"
  local job_type="$2"

  if [[ -z "$job_type" ]]; then
    error "RUN_JOB_TYPE is required"
  fi

  if ! validate_run_job_type_for_environment "$environment" "$job_type"; then
    error "Unsupported ${environment} run-job type: ${job_type}"
  fi
}

require_run_job_type() {
  local job_type="$1"

  if [[ -z "$job_type" ]]; then
    error "RUN_JOB_TYPE is required"
  fi

  if ! validate_run_job_type "$job_type"; then
    error "Unsupported run-job type: ${job_type}"
  fi
}
