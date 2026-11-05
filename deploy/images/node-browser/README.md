# node-browser

db3's base image for apps that drive a browser: Node 24 with Playwright's Chromium and the
system libraries it needs, for ARM (`linux/arm64`) and Intel (`linux/amd64`).

```Dockerfile
FROM ghcr.io/db3ai/node-browser:24-playwright-1.63.0
```

Pick the tag whose Playwright version matches your app's `playwright` package exactly, or
Playwright won't find its browser. Browsers are in `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`);
the image runs as the `node` user (uid 1000) in `/app`.

| Tag | Contents |
| --- | --- |
| `24-playwright-<version>` | Node 24 (latest patch db3 builds) and that Playwright's Chromium |
| `<node>-playwright-<version>` | The same, pinned to one Node release, such as `24.15.0-playwright-1.63.0` |

Built by `.github/workflows/base-images.yml` when this folder changes and every Monday, so
Debian and Node security fixes reach apps on their next deploy. To add a Playwright version,
add it to `deploy/images/versions.json`.

Why: an app image built on top of this only installs its npm packages and copies its compiled
code, so a deploy downloads no Chromium and installs no system packages, and builds stay small
enough for any server.
