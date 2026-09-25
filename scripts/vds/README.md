# VDS run-job contract templates

These files document the root-owned VDS side of the restricted `run-job`
contract introduced in Stage 4.2.

They are not executed from the repository checkout. On the VDS, the installed
files must be owned by `root`, writable only by `root`, and invoked only from the
environment-specific forced SSH command through the existing restricted sudo
boundary.

Installed paths:

```text
/usr/local/sbin/tuttoseriea-run-job-staging
/usr/local/sbin/tuttoseriea-run-job-production
```

The forced SSH commands expose only:

```text
run-job football.sync-serie-a-foundation
```

The deploy user must not receive Docker group membership, direct Docker socket
access, arbitrary sudo, a free shell, arbitrary image selection, arbitrary
entrypoint/command selection, arbitrary job arguments, or caller-controlled
environment injection.
