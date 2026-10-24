# Framework Actions worker

Automatic push and pull request checks stay on GitHub-hosted Ubuntu runners. To
run the same checks on the ARM64 worker, open **Actions → Framework checks → Run
workflow**. Manual dispatch uses `worker` automatically. This manual route only uses trusted repository
workflow code. This workflow routes pull request jobs to GitHub-hosted runners.

The repository-scoped runner is `worker-framework-ci`, labelled `self-hosted`,
`Linux`, `ARM64`, and `framework-ci`. On the Ubuntu VM it lives at
`/home/steve/actions-runner-framework` and runs as the enabled user service
`actions-runner-framework.service`. Its unit starts the runner in the `docker`
group with `sg docker` and uses `KillMode=control-group` to stop every child
listener cleanly. The VM also needs `build-essential` for native Node packages,
including `node-pty`. Check the service with:

```sh
ssh steve@worker 'systemctl --user status actions-runner-framework.service'
```

Framework CI maps MariaDB to host port `13306` and Redis to `16379`, separate
from Scout's test services. The MariaDB and Redis services use uniquely named volumes.
The runner's `.env` sets `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` to an installed copy
of `scripts/cleanupFrameworkCiVolumes.sh`; it deletes only matching Framework CI
volumes after service containers stop. Keep that copy in sync with this file.
