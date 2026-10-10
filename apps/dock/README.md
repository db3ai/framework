# Dock

A local process manager for db3 apps. Add a project folder and Dock runs its
`npm run` scripts (api, dev/web, queue workers, scheduler, anything else in
`package.json`) in their own folders. Each process gets live output, status,
port, CPU and memory, and controls for start, stop and restart. You no longer
need a terminal tab per process.

- **List view:** one card per project, with the selected process's output docked below.
- **Real terminals:** every pane is an xterm.js terminal, as in VS Code and Cursor. Click in and
  type; Ctrl-C, prompts, progress bars and tools' own shortcuts (such as Vite's) all work.
- **Terminals view:** every process of a project side by side.
- **Add process:** queue workers built from `queue:work` selections (specific
  queues, all except some, or a named pool), a scheduler, or any other script.
  Queue names and pools come from a static scan of the app's source.
- **Project switcher and collapsible sidebar** for many projects.
- **Light, dark or system theme** from the header; terminal colours adapt too.

Dock is a self-contained app in this workspace so it can later move into
Studio. The process manager (`server/Dock.ts`) has no HTTP knowledge, and the
HTTP API (`server/createServer.ts`) is a thin layer over it.

## Run

```sh
npm run dev:dock
```

Open http://127.0.0.1:5179 and choose **Add project** with a folder such as
`~/Sites/scout`. Dock adds the project's `api`, `dev`, `web`, `queue`, `worker`
and `scheduler` scripts if present. Queue and scheduler scripts get
`queue:work` / `scheduler:work` unless the script already includes it.
Nothing starts until you press start (or set `DOCK_AUTOSTART=1`).

For a single built server instead of Vite: `npm start --workspace db3-dock`,
then open http://127.0.0.1:8790.

### Desktop app (Electron)

For development in one command, from the repository root:

```sh
npm run dev:dock:electron
```

This starts the Dock server and Vite, waits for both, then opens Electron on
the Vite UI with hot reload. Closing the window (or Ctrl-C) stops everything. It
uses its own Electron profile, so it opens beside a regular Dock window rather
than handing off to it.

`electron/` is an isolated shell with its own dependencies, like the starter's.
It uses a Dock server already on port 8790, or starts one. Quitting the app
stops that server and every process it supervises.

```sh
cd apps/dock/electron
npm install --workspaces=false
npm start
```

From the web UI, **Desktop app** in the header does the same: the Dock server
builds and launches the shell, which attaches to that server and shows the page
you were on (the Vite UI in development). If the shell is not installed yet,
the button shows the install command. The button is hidden inside the desktop app.

The shell spawns `node` from your `PATH`, so start it from a terminal (or a
login shell) where `node` is Node 24+. Packaging, signing and a menu-bar tray
are not set up yet.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOCK_CONFIG` | `~/.db3-dock/projects.json` | Saved projects and processes |
| `DOCK_PORT` | `8790` | API port |
| `DOCK_CLIENT_PORT` | `5179` | Vite port in development |
| `DOCK_EDITOR` | `cursor` | Command used by **Open in editor** (`code`, `zed`, …) |
| `DOCK_AUTOSTART` | unset | `1` starts every saved process on launch |
| `DOCK_LOG` | unset | `1` logs HTTP requests |
| `DOCK_CADDY_ADMIN` | `http://localhost:2019` | Caddy admin API used for local domains |

Processes added with **Save to project** unticked last until Dock exits.

## Security

Dock runs commands on your machine. The server only listens on a loopback
address and rejects requests whose `Host` or `Origin` is not loopback, so other
websites (including DNS-rebinding pages) cannot drive it. It only runs scripts
that exist in a project's `package.json`, with arguments chosen in the UI.

## How it works

- Each process is `npm run <script> -- <args>` running in its own pseudo-terminal
  (`node-pty`, `TERM=xterm-256color`), like VS Code's integrated terminal. Scripts
  see a real terminal, so they colour their output and read keystrokes. The PTY
  child leads its own process group: Stop sends SIGTERM to the group, then
  SIGKILL after 8s. Exit code 0, a requested stop or Ctrl-C shows **Stopped**;
  anything else **Exited (n)**.
- Panes are xterm.js terminals (WebGL renderer, DOM fallback) fitted to their
  pane; each reports its size to its process. Output streams over server-sent
  events; keystrokes and sizes go over a WebSocket at `/api/terminal`, with the
  same loopback checks as the HTTP API. Cmd/Ctrl+click opens links, Cmd/Ctrl+K
  clears. Each process keeps about 1 MB of raw scrollback, replayed when a pane
  opens. If one process shows in two panes at once, the last resized sets its size.
- `node-pty`'s macOS `spawn-helper` can install without its execute bit; Dock
  fixes the mode when it opens.
- A process's main port is the first `localhost:NNNN` in its output. Failing that,
  Dock picks one of the TCP ports its process group listens on: one Caddy maps a
  domain to, then a fixed port below the OS's random-port range (32768+), then
  any. Every listening port is shown; the others appear beside the main link.
  An unexpected one is worth a look. For example, a random port in Scout's queue
  worker turned out to be Crawlee's `proxy-chain` server, started just by
  importing `crawlee`.
- If Caddy is running, Dock reads its live config from the admin API every 10s
  and links ports to their local domains (`:8000` → `local.growthscout.io`,
  `:8300` → `local.db3.ai/framework`). Hover a link to see every address.
- CPU and memory are summed over the process group from `ps` every 3s (macOS/Linux).
- Every 4s Dock scans for `npm run <script>` jobs started elsewhere (a terminal,
  Cursor), using `ps` and `lsof`, so it works in the browser and in Electron. A job is
  matched to a project by its working folder and to a process by script name;
  an extra one (say a second queue worker) gets a session-only entry. These show
  as **outside Dock**: status, pid, uptime, CPU, memory and port work, but their
  output stays in the terminal that started them. Stop ends the job; Restart runs
  it inside Dock with live output. Removing a project or quitting Dock leaves them running.
  npm hides script arguments from the process title, so jobs are matched by
  script name only.

## Layout

```
shared/   Wire contracts and pure helpers used by both sides (ANSI, ports, worker args)
server/   Dock (process manager), ProjectStore, SupervisedProcess, HTTP API
client/   Vue UI: dock/ holds state and logic, components/ holds UI
electron/ Isolated desktop shell
tests/    Vitest: real npm processes against a temporary fixture project
```

## Verify

```sh
npm test --workspace db3-dock
npm run build --workspace db3-dock
cd apps/dock/electron && npm test
```

## Next

- A `queue:list --json` console command in `@db3.ai/app/queue` would replace the
  source scan with the app's real registered queues and pools.
- Menu-bar tray with status and quick toggles.
- Auto-restart with back-off for crashed workers.
