# VDS operational contract templates

This directory contains the reviewed repository sources for root-owned VDS
operational contracts. Each live copy is provisioned manually from a trusted
`main` commit; the normal application deployment does not install or update
these files.

The provisioning chain is reviewed repository canonical source -> explicit
manual infrastructure provisioning -> root-owned live VDS file. Merging these
sources does not install them or change running services. Deployment-state
writers retain the captured release transitions and include the MASTER-approved
final state-directory sync after each rename and after clearing previous-release.
Applying that durability correction on the VDS requires later explicit provisioning.

The canonical sources and intended destinations are:

| Repository source | VDS destination | Owner/group | Mode |
| --- | --- | --- | --- |
| `scripts/vds/tuttoseriea-deploy-staging` | `/usr/local/sbin/tuttoseriea-deploy-staging` | `root:root` | `0755` |
| `scripts/vds/tuttoseriea-verify-staging` | `/usr/local/sbin/tuttoseriea-verify-staging` | `root:root` | `0700` |
| `scripts/vds/tuttoseriea-deploy-production` | `/usr/local/sbin/tuttoseriea-deploy-production` | `root:root` | `0755` |
| `scripts/vds/tuttoseriea-verify-production` | `/usr/local/sbin/tuttoseriea-verify-production` | `root:root` | `0700` |
| `scripts/vds/tuttoseriea-rollback-production` | `/usr/local/sbin/tuttoseriea-rollback-production` | `root:root` | `0700` |
| `scripts/vds/tuttoseriea-read-previous-production` | `/usr/local/sbin/tuttoseriea-read-previous-production` | `root:root` | `0700` |
| `scripts/vds/tuttoseriea-ssh-production` | `/usr/local/sbin/tuttoseriea-ssh-production` | `root:root` | `0755` |
| `scripts/vds/tuttoseriea-read-release-state-production` | `/usr/local/sbin/tuttoseriea-read-release-state-production` | `root:root` | `0700` |
| `scripts/vds/compose-staging.yaml` | `/srv/tuttoseriea/staging/config/compose.yaml` | `root:root` | `0600` |
| `scripts/vds/compose-production.yaml` | `/srv/tuttoseriea/production/config/compose.yaml` | `root:root` | `0600` |
| `scripts/vds/tuttoseriea-ssh-staging` | `/usr/local/sbin/tuttoseriea-ssh-staging` | `root:root` | `0755` |
| `scripts/vds/tuttoseriea-deploy.sudoers` | `/etc/sudoers.d/tuttoseriea-deploy` | `root:root` | `0440` |
| `scripts/vds/tuttoseriea-read-current-staging` | `/usr/local/sbin/tuttoseriea-read-current-staging` | `root:root` | `0755` |
| `scripts/vds/tuttoseriea-run-job-common.sh` | `/usr/local/sbin/tuttoseriea-run-job-common.sh` | `root:root` | `0644` |
| `scripts/vds/tuttoseriea-run-job-staging` | `/usr/local/sbin/tuttoseriea-run-job-staging` | `root:root` | `0755` |
| `scripts/vds/tuttoseriea-dispatch-match-lifecycle-staging` | `/usr/local/sbin/tuttoseriea-dispatch-match-lifecycle-staging` | `root:root` | `0755` |
| `scripts/vds/tuttoseriea-match-lifecycle-staging.service` | `/etc/systemd/system/tuttoseriea-match-lifecycle-staging.service` | `root:root` | `0644` |
| `scripts/vds/tuttoseriea-match-lifecycle-staging.timer` | `/etc/systemd/system/tuttoseriea-match-lifecycle-staging.timer` | `root:root` | `0644` |

The run-job templates also include a Production delegator, but this change does
not provision or alter Production:

```text
/usr/local/sbin/tuttoseriea-run-job-production
```

The full Production reader is a new reviewed source for trusted root-owned
infrastructure consumers; its live installation is not implied by repository
delivery. It accepts no arguments and reads only current-release,
verified-release and previous-release in `/srv/tuttoseriea/production/state`.
It uses non-blocking flock on `/run/lock/tuttoseriea-production-deploy.lock`,
with the existing `exec 9>"$LOCK_FILE"` open/create pattern. It does not modify
release-state or invoke Docker. Its complete snapshot output is:

```text
current <GIT_SHA WEB_IMAGE_DIGEST AI_SERVICE_IMAGE_DIGEST | absent>
verified <GIT_SHA WEB_IMAGE_DIGEST AI_SERVICE_IMAGE_DIGEST | absent>
previous <GIT_SHA WEB_IMAGE_DIGEST AI_SERVICE_IMAGE_DIGEST | absent>
```

All existing records must be exactly one canonical three-field tuple; empty,
malformed and legacy two-field records fail closed with no partial stdout.
Missing records are explicitly absent. The reader has no deploy sudoers rule
and no forced-command route. The existing narrow previous-release SSH interface
and legacy argument handling remain unchanged.

The two Compose sources are explicit environment files with relative references
to separately provisioned runtime.env, ai-service.env and postgres.env. They
preserve the captured project names, ports, services and project-scoped volume.
Real env files remain outside Git. Normal application deployment reads the live
Compose file; it does not generate or replace it.

## Repository checks

From the repository root on Linux with Bash, flock, Node.js and Docker Compose CLI:

```bash
bash scripts/check-run-job-wrapper.sh
bash scripts/check-vds-infrastructure.sh
/usr/sbin/visudo -cf scripts/vds/tuttoseriea-deploy.sudoers
```

The focused check uses disposable fixture copies and Docker/sudo/sync command
stubs; it never executes the canonical deploy scripts against live paths or
starts application containers. It exercises real flock and verifies state
transitions, write/rename/directory-sync ordering and injected failure behavior.
Compose config parsing does not resolve runtime env files or image digests.
For split LOCAL verification, --shell-only runs Linux fixture checks and
--compose-only runs Compose checks; each reports the omitted component as not_run.
Missing native visudo must be reported explicitly; CI retains its native check.

Live ad hoc edits are not the normal workflow. If emergency recovery requires a
live change, the resulting contract must be reconciled back into these reviewed
sources before later provisioning treats the repository as authoritative.

STAGING deployment state is owned by the existing deployment infrastructure.
Operational consumers must not guess or derive deployment-state filesystem
paths. STAGING run-job obtains the current release tuple only through:

```text
/usr/local/sbin/tuttoseriea-read-current-staging
```

That reader accepts no arguments, reads the authoritative STAGING state file at
`/srv/tuttoseriea/staging/state/current-release`, validates the exact canonical
three-field tuple format, and prints only:

```text
<GIT_SHA> <WEB_IMAGE_DIGEST> <AI_SERVICE_IMAGE_DIGEST>
```

The STAGING forced SSH command exposes five exact zero-argument identifiers:

```text
run-job football.sync-serie-a-foundation
run-job football.sync-serie-a-matches
run-job football.sync-serie-a-standings
run-job football.sync-serie-a-squads
run-job football.sync-serie-a-player-statistics
```

It also exposes exactly three Match-scoped command shapes:

```text
run-job football.sync-serie-a-match-events --match-id <lowercase-uuid>
run-job football.sync-serie-a-match-lineups --match-id <lowercase-uuid>
run-job football.sync-serie-a-match-statistics --match-id <lowercase-uuid>
```

`<lowercase-uuid>` is validated at the repository launcher, forced SSH,
root-owned wrapper and application CLI boundaries. No raw argument string or
other job argument is accepted.

PRODUCTION remains limited to `run-job football.sync-serie-a-foundation`;
the STAGING-only extensions do not add Production provisioning, sudo allowance,
or execution.

The deploy user must not receive Docker group membership, direct Docker socket
access, arbitrary sudo, a free shell, arbitrary image selection, arbitrary
entrypoint/command selection, arbitrary job arguments, or caller-controlled
environment injection.

## STAGING Match lifecycle dispatcher

The Match lifecycle dispatcher is app-owned code packaged in the immutable Web
image. The root-owned one-minute systemd timer only invokes the fixed wrapper;
the wrapper accepts no arguments, resolves the current Web digest through the
approved restricted STAGING release reader and runs the fixed dispatcher
entrypoint with `--pull never` on the fixed STAGING network.

Dispatcher configuration is a stable, manually provisioned root-owned file:

```text
/srv/tuttoseriea/staging/config/match-dispatcher.env
```

It must be `root:root` mode `0600` and contain a deployment-independent
activation boundary. `FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM` has no default:

```text
FOOTBALL_MATCH_DISPATCHER_MANAGED_FROM=2026-10-05T12:00:00Z
FOOTBALL_MATCH_DISPATCHER_RECOVERY_HORIZON_SECONDS=86400
FOOTBALL_MATCH_DISPATCHER_FINAL_CONFIRMATION_DELAY_SECONDS=1800
FOOTBALL_MATCH_DISPATCHER_MAX_CONCURRENCY=2
FOOTBALL_MATCH_DISPATCHER_LINEUP_CONFIRMATION_LEAD_SECONDS=600
FOOTBALL_MATCH_DISPATCHER_LINEUP_LIVE_RECOVERY_SECONDS=3600
FOOTBALL_MATCH_DISPATCHER_FAILURE_COOLDOWN_SECONDS=300
```

The example timestamp is not an installation value. Provisioning must choose
and review the real UTC activation boundary. Application deployment does not
install this file, the wrapper, or the systemd units, and it does not enable or
start the timer. Installation requires a later explicit operational gate.
