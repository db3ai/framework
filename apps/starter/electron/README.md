# Starter Electron experiment

An optional desktop shell for the **existing** starter frontend. There is no
second Vue build, copied client, local API server or database inside Electron.
All desktop source, dependencies, lockfile, tests and output live here. This
folder is deliberately excluded from the generated web starter.

## Run

Use Node.js 24 or newer. First configure and start the normal starter from the
repository root, following its README (including database migrations):

```sh
npm run dev --workspace db3-starter
```

In another terminal:

```sh
cd apps/starter/electron
npm ci --workspaces=false
npm start
```

Open the same `http://localhost:5173` address in a browser. Edit a component in
`apps/starter/client/`: both clients use the same Vite server and hot updates.
Electron needs the starter API and database just as the website does. Closing
Electron does not stop the separately managed starter development servers.

`src/desktop.config.ts` owns the name, frontend URL and explicit permission for
loopback HTTP. Match the starter's `APP_ORIGIN` exactly. Password sign-in uses
the existing HttpOnly cookies, in Electron's own persistent profile. A browser
login is not shared with Electron. The existing session expiry still applies.

For local tests or a different dev port, unpackaged runs accept
`DB3_ELECTRON_URL` and `DB3_ELECTRON_PROFILE`. Packaged apps ignore those overrides.
The normal profile is `db3-starter-electron` beneath Electron's OS application
data directory (on macOS, `~/Library/Application Support`).

## Build a local application

```sh
npm run package
```

This produces a **local application for the current operating system and
CPU** beneath `out/` (a `.app` on macOS). With the default configuration it
still connects to local Vite, so the starter must be running. This is a local
experiment, not a public release: developer signing, notarization and an
installer are not configured. Electron's binary may retain an ad-hoc signature.

For a hosted experiment, set `url` to the deployed HTTPS frontend and
`allowLocalHttp` to `false` in `src/desktop.config.ts`, then rebuild/package.
The frontend and API must share that origin, as in the starter's existing
production setup. Web deployments appear on reload; shell changes require
rebuilding the desktop application. Never put server credentials or `.env`
contents into desktop configuration.

## Scope and boundaries

- Sandboxed renderer, context isolation, Node disabled and browser security on.
- No preload script, IPC API or native bridge exposed to the frontend.
- Same-origin links stay in one window; ordinary external HTTP(S) links open
  the system browser. Other schemes, cross-origin frames/redirects, downloads
  and permission requests are blocked. Google/OAuth handoff is not implemented.
- An unavailable frontend shows a local **Try again** screen. There is no
  offline data store, background sync, updater, native push or mobile support.
- macOS keeps the application alive after closing the window; use Quit to exit.
  Launching a second instance brings the existing window forward.

No shared `@db3.ai/electron` package is introduced yet. Once the starter proves
which behaviours are reusable, they can move into an optional package while
this folder retains app configuration and desktop assets.

## Verification

```sh
npm test
```

The command compiles TypeScript, runs URL-policy tests, and launches actual
Electron processes against a disposable HTTP fixture. It checks renderer
isolation, denied permissions, same-origin navigation, external-link routing,
blocked redirects, HttpOnly-cookie persistence across restart and outage/retry
behaviour. A desktop session is required. Tests own temporary profiles and close
their processes/server in `finally`; no personal browser session is used.
These fixture tests do not replace checking the real starter login/API flow.

At the repository root, creator tests verify that generated applications do not
inherit the desktop experiment. The starter Vitest config excludes this folder
because its Electron tests have their own runner.
