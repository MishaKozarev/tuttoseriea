# VDS operational contract templates

This directory contains the reviewed repository sources for root-owned VDS
operational contracts. Each live copy is provisioned manually from a trusted
`main` commit; the normal application deployment does not install or update
these files.

The canonical STAGING boundary sources and destinations are:

| Repository source | VDS destination | Owner/group | Mode |
| --- | --- | --- | --- |
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
