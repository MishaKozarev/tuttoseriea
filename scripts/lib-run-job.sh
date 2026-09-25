#!/usr/bin/env bash

RUN_JOB_ALLOWED_TYPES=(
  "football.sync-serie-a-foundation"
)

validate_run_job_type() {
  local job_type="$1"

  for allowed_type in "${RUN_JOB_ALLOWED_TYPES[@]}"; do
    if [[ "$job_type" == "$allowed_type" ]]; then
      return 0
    fi
  done

  return 1
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
