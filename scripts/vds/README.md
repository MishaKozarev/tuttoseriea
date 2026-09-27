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

The STAGING forced SSH command exposes only these exact identifiers:

```text
run-job football.sync-serie-a-foundation
run-job football.sync-serie-a-matches
run-job football.sync-serie-a-standings
```

PRODUCTION remains limited to `run-job football.sync-serie-a-foundation`;
the STAGING matches and standings extensions do not add Production
provisioning, sudo allowance, or execution.

The deploy user must not receive Docker group membership, direct Docker socket
access, arbitrary sudo, a free shell, arbitrary image selection, arbitrary
entrypoint/command selection, arbitrary job arguments, or caller-controlled
environment injection.
