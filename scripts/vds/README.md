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
| `scripts/vds/tuttoseriea-reconcile-images` | `/usr/local/sbin/tuttoseriea-reconcile-images` | `root:root` | `0700` |
| `scripts/vds/tuttoseriea-reconcile-images.service` | `/etc/systemd/system/tuttoseriea-reconcile-images.service` | `root:root` | `0644` |
| `scripts/vds/tuttoseriea-reconcile-images.timer` | `/etc/systemd/system/tuttoseriea-reconcile-images.timer` | `root:root` | `0644` |

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

## Host-wide image retention

`tuttoseriea-reconcile-images` is a Linux root-owned infrastructure consumer for
the shared STAGING/PRODUCTION Docker image store. It requires Bash, Python 3
(standard library only), flock, procfs and the local Docker CLI/socket. It accepts
only `--dry-run` (also the default) or explicit `--apply`. There is no caller
environment injection, alternative daemon, state path or repository override.

The protected set is the union of:

- STAGING current-release and verified-release, both Web and AI;
- PRODUCTION current-release, verified-release and previous-release, both Web
  and AI, with each reader-declared absence allowed independently;
- all running container images and, conservatively, stopped/created container
  image references;
- the local image ID for `pgvector/pgvector:0.8.6-pg18`.

STAGING's two authoritative files are read under its existing deployment lock
at `/srv/tuttoseriea/staging/state/{current,verified}-release`; both must exist
and contain exactly one canonical three-field tuple. This is a root-owned
infrastructure consumer, not an expansion of the restricted application/run-job
current-release interface.

PRODUCTION state is obtained only through the existing zero-argument
`/usr/local/sbin/tuttoseriea-read-release-state-production`; the reconciler has
no Production state-file paths. A private Bash helper sources its exact reviewed
root-owned `0700` implementation, retaining the reader's open flock FD 9 after
the snapshot. A private Unix socket transfers that same locked open file
description to the parent via SCM_RIGHTS, so helper death cannot drop the lock
between validation and deletion. Delete subprocesses also inherit all three
coordination descriptors. Helper death stops further deletes. The reader's
SHA-256 is pinned to
`113ff4f062d66586af3017cb43e41bee280ad9bb272aad32a9c1beaa155cb30b`.
Reader changes require an explicit lock-lease review, not relaxed matching.
The helper's framing is private; the public reader output/arguments and all
deploy/verify/rollback sources remain unchanged.

Coordination order is fixed: `/run/lock/tuttoseriea-image-reconcile.lock`, then
`/run/lock/tuttoseriea-staging-deploy.lock`, then the Production reader's
`/run/lock/tuttoseriea-production-deploy.lock`. Reconciliation retains all three
locks through every deletion. Re-sourcing the reader reacquires only the last
lock; snapshots and mappings are revalidated afterward, before any delete.
Busy, lost or replaced locks, unsafe ownership/modes/ACLs, malformed/missing
STAGING state, reader failure/drift, failed Docker queries or unsafe/ambiguous
mappings stop deletion. Trusted directories must be root-owned and not group/world
writable (the root-owned sticky `/run/lock` exception is allowed), with no
unreviewed ACLs/xattrs. State files must be root-owned `0600` regular files.
The Production lock file is checked/created safely without following symlinks
before invoking the unchanged reader's open/truncate operation.
Dry-run may create/open coordination lock files; it never changes release state
or images.

Only these two exact repositories confer cleanup authority:

```text
ghcr.io/mishakozarev/tuttoseriea/web
ghcr.io/mishakozarev/tuttoseriea/ai-service
```

Manifest RepoDigests are resolved to exact local image IDs, independently of
config digests. Candidate IDs need unambiguous whitelist RepoDigests and no
foreign aliases; tags, age, source labels or dangling status alone never
authorize deletion. A protected ID retains every alias. Third-party images
remain untouched; unclassified/digestless or mixed aliases are retained and
block destructive apply. Even one incomplete environment snapshot or unsafe
mapping blocks all deletion.

MASTER-approved degraded-but-operational protection distinguishes missing local
images from invalid release state. After a complete validated local inventory,
a valid release RepoDigest with no local binding is recorded as
`missing_protected` with its environment, release label and exact reference.
It is not malformed state. The reconciler never pulls or restores that image.
Existing release bindings still require exact inspect-to-inventory agreement;
inventory/inspect errors or contradictory/ambiguous mappings are not absence.

Missing local release images alone allow cleanup when both state snapshots are
valid, all existing protected mappings are unambiguous, runtime and pgvector
protection is valid, and classification introduces no unsafe ambiguity. Missing
state, malformed records, reader/lock failures, missing runtime/pgvector
mappings or other incomplete safety information still mean NO DELETE. Candidate
authority and exact-ID retention rules are unchanged.

Apply uses only the initially calculated candidates, refreshing release and
container protection and checking unchanged aliases before each exact
`docker image rm --no-prune <image-id>`. Newly protected/disappeared candidates
are skipped. No force, parent pruning, pull, container mutation, volume access,
or deploy/verify/migration command is used. A deletion error stops all remaining
deletes, even if that ID has already disappeared. Re-running is idempotent.

Stdout is a JSON report: mode, protection_complete, environment/runtime/pgvector
protection, candidates, retained/ambiguous IDs, skips, confirmed deleted IDs,
delete_attempts and errors. A compact human summary goes to stderr. An attempt
with outcome `unconfirmed` denotes a timeout/interruption or unavailable
post-delete inventory; it is never falsely reported as a confirmed deletion.
No env values or raw Docker/reader diagnostics are printed. Exit codes are
`0` complete, `2` invalid/incomplete/ambiguous protection, `75` reconciler or
STAGING lock contention, and `1` operational failure. Production lock contention
is reader failure (`2`). `partial` means a delete was attempted before failure.

Both dry-run and apply include `missing_protected` in JSON and print one
`WARNING missing_protected` line per observed missing reference to stderr.
Warnings are deduplicated and retained through all refreshes in that invocation,
including when an image later becomes available; they recur on every invocation
while the absence persists. No warning acknowledgement or mutable warning state
is created. `staging_protection` and `production_protection` report `HEALTHY`,
`DEGRADED` (a missing local release image), or `UNKNOWN` (not yet validated) for
the latest snapshot. `cleanup_authority` is `AVAILABLE` only after all safety
gates pass; any failure reports `NO_DELETE`. A successful degraded run still
exits `0` with `status=complete`: `protection_complete=true` means deletion safety
information is complete, not that every release image exists locally.

The oneshot unit calls explicit `--apply` and requires Docker already active;
it cannot start Docker. The timer source schedules daily at 03:30 UTC with up to
ten minutes of jitter and persistent catch-up. These sources are NOT installed
or activated by this change, CI, or application delivery. Future rollout must
separately approve trusted manual provisioning, inspect a successful dry-run,
perform the first explicitly approved manual apply, then approve timer
activation as a separate step. No deploy/verify hooks or SSH/sudoers expansion
are included.

## Repository checks

From the repository root on Linux with Bash, flock, Python 3, Node.js and Docker
Compose CLI:

```bash
bash scripts/check-run-job-wrapper.sh
bash scripts/check-vds-infrastructure.sh
bash scripts/check-image-retention.sh
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

The image-retention check uses a private disposable filesystem, the canonical
Production reader fixture and a fake Docker CLI only. It never accesses the
real Docker socket or deletes real images. Every fake delete checks that all
three real flock locks are held, including forced helper termination. It covers
independent releases, reader/state
failures, ambiguous mappings, aliases, late protection changes, exact deletion,
partial failure and idempotency. Missing STAGING verified/current and Production
previous images are tested in dry-run and fake apply, including persistent
warnings, remaining protected images, reappearing aliases and all blocking
state/mapping/runtime failures. When available, systemd-analyze validates
private copies of the units with fixture executable/dependency locations; it
does not load/activate units. An unavailable analyzer is reported as not_run;
CI requires it and runs this native check.

The explicit `--docker-format-only` mode instead performs only read-only image
inspect calls through the real LOCAL Docker CLI, against the already present
`pgvector/pgvector:0.8.6-pg18` image. It tests the canonical Go template with
absent image labels and compares the required metadata projection; it never
pulls images or invokes the reconciler. It uses a fixed local daemon endpoint,
not a caller-selected Docker context. Run it separately with:

```bash
bash scripts/check-image-retention.sh --docker-format-only
```

CI requires both modes. Optional OCI source labels may be absent; this does not
relax RepoDigest-to-ID validation, protection or candidate classification.

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
