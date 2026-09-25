# VDS run-job contract templates

These files document the root-owned VDS side of the restricted `run-job`
contract introduced in Stage 4.2.

They are not executed from the repository checkout. On the VDS, the installed
files must be owned by `root`, writable only by `root`, and invoked only from the
environment-specific forced SSH command through the existing restricted sudo
boundary.

Installed paths:

```text
/usr/local/sbin/tuttoseriea-read-current-staging
/usr/local/sbin/tuttoseriea-run-job-staging
/usr/local/sbin/tuttoseriea-run-job-production
```

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

The forced SSH commands expose only:

```text
run-job football.sync-serie-a-foundation
```

The deploy user must not receive Docker group membership, direct Docker socket
access, arbitrary sudo, a free shell, arbitrary image selection, arbitrary
entrypoint/command selection, arbitrary job arguments, or caller-controlled
environment injection.
