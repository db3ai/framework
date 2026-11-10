# ci-runner

A GitHub Actions runner on [node-browser](../node-browser): Node 24, Playwright's Chromium and
its system libraries, git and the runner, for ARM and Intel.

db3 Cloud runs it on servers ticked **GitHub Actions** under Servers. Each job gets a fresh pod
with this image and its own MariaDB on `127.0.0.1:3306` (user `root`, password `root`); the
runner takes one job through a just-in-time config and exits, and the pod goes.

| Tag | Contents |
| --- | --- |
| `24-playwright-<version>` | node-browser with that Playwright, and the newest runner when it was built |

Built by `.github/workflows/base-images.yml` after node-browser, when this folder changes and
every Monday, so GitHub never refuses jobs to an outdated runner.
