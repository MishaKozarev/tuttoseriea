#!/usr/bin/env bash

RUN_JOB_STAGING_ALLOWED_TYPES=(
  "football.sync-serie-a-foundation"
  "football.sync-serie-a-matches"
  "football.sync-serie-a-standings"
  "football.sync-serie-a-squads"
  "football.sync-serie-a-player-statistics"
  "football.sync-serie-a-match-events"
  "football.sync-serie-a-match-lineups"
  "football.sync-serie-a-match-statistics"
)

RUN_JOB_STAGING_MATCH_SCOPED_TYPES=(
  "football.sync-serie-a-match-events"
  "football.sync-serie-a-match-lineups"
  "football.sync-serie-a-match-statistics"
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

validate_run_job_match_id() {
  if [[ "$#" -ne 1 ]]; then
    return 1
  fi

  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
}

run_job_type_requires_match_id_for_environment() {
  if [[ "$#" -ne 2 || "$1" != "staging" ]]; then
    return 1
  fi

  local job_type="$2"
  local match_scoped_type

  for match_scoped_type in "${RUN_JOB_STAGING_MATCH_SCOPED_TYPES[@]}"; do
    if [[ "$job_type" == "$match_scoped_type" ]]; then
      return 0
    fi
  done

  return 1
}

validate_run_job_invocation_for_environment() {
  if [[ "$#" -lt 2 ]]; then
    return 1
  fi

  local environment="$1"
  local job_type="$2"
  shift 2

  validate_run_job_type_for_environment "$environment" "$job_type" || return 1

  if run_job_type_requires_match_id_for_environment "$environment" "$job_type"; then
    [[ "$#" -eq 2 && "$1" == "--match-id" ]] || return 1
    validate_run_job_match_id "$2"
    return
  fi

  [[ "$#" -eq 0 ]]
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

require_run_job_invocation_for_environment() {
  local environment="$1"
  shift

  if ! validate_run_job_invocation_for_environment "$environment" "$@"; then
    error "Invalid ${environment} run-job invocation"
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
