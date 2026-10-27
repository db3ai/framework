# Dock

[db3.ai](https://db3.ai/) · [Dock documentation and screenshots](https://db3.ai/framework/docs/dock) · [Projects and terminals](https://db3.ai/framework/docs/dock-processes) · [Servers and routes](https://db3.ai/framework/docs/dock-servers)

A local process manager for db3 apps. Add a project folder and Dock runs its
`npm run` scripts (api, dev/web, queue workers, scheduler, anything else in
`package.json`) in their own folders. Each process gets live output, status,
port, live CPU and memory sparklines, and controls for start, stop and restart. You no longer
need a terminal tab per process.

- **List view:** one card per project, with the selected process's output docked below.
- **Real terminals:** every pane is an xterm.js terminal, as in VS Code and Cursor. Click in and
  type; Ctrl-C, prompts, progress bars and tools' own shortcuts (such as Vite's) all work.
- **Terminals view:** every process of a project side by side.
- **Add process:** queue workers built from `queue:work` selections (specific
  queues, all except some, or a named pool), a scheduler, or any other script.
  Queue names and pools come from a static scan of the app's source.
- **Git branch** next to each project's name, so you can see which checkout
  you are about to run. It updates within a few seconds of a checkout made
  elsewhere; a detached HEAD shows its short commit.
- **Project switcher and collapsible sidebar** for many projects.
- **Light, dark or system theme** from the header; terminal colours adapt too.
- **Servers:** watch the Docker containers on other machines (or this one) over SSH,
  grouped by app, with blue/green slots, what serves live traffic, load and live logs.

Dock is a self-contained app in this workspace so it can later move into
Studio. The process manager (`server/Dock.ts`) has no HTTP knowledge, and the
HTTP API (`server/createServer.ts`) is a thin layer over it.

## Run

```sh
npm run dev:dock
```

Open http://127.0.0.1:5179 and choose **Add project** with a folder such as
`~/Sites/scout`. If the folder has a `db3.app.json` (see [App profile](#app-profile)),
Dock adds the processes it lists. Otherwise it adds the project's `api`, `dev`,
`web`, `queue`, `worker` and `scheduler` scripts if present. Queue and scheduler
scripts get `queue:work` / `scheduler:work` unless the script already includes it.
Nothing starts until you press start (or set `DOCK_AUTOSTART=1`).

### App profile

`db3.app.json` in a project's root describes how the app is built and run,
wherever it runs: its processes, build script, database and environment
variable names (never values). Dock uses it to set up processes; deployment
tooling will read the same file. New apps from `create-db3` include one; see
`apps/starter/db3.app.json`.

Each process runs an npm script: `script` once deployed, `dev` (if set) in Dock.
`kind` (`api`, `web`, `queue`, `scheduler` or `script`) defaults from the name.
`port` and `health` say where a process listens and which path answers once it
is ready. Database connection variables come from the host, so they are not
listed. Dock refuses an invalid profile, or one naming a script `package.json`
lacks, and says which field is wrong. The format lives in `shared/appProfile.ts`.

### Create a new app

**Add project → Create app** makes a new db3 app with `create-db3` (the
starter: login, private notes, optional AI) in a folder you choose, then adds
it like any other project. Pick MariaDB in Docker or a local MariaDB. With
**Install and migrate now**, a session-only `setup` terminal starts the Docker
database (or waits while you fill in the `DB_` values in `.env`), runs
`npm install` and `npm run db:migrate`; then press start on `web`. Setup needs
Node 24 or newer in Dock's terminals, so start Dock from a Node 24 shell.

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

The app icon is `electron/assets/icon.png`, rendered at 1024px from
`electron/assets/icon.svg`; re-render the PNG after changing the SVG.

The shell spawns `node` from your `PATH`, so start it from a terminal (or a
login shell) where `node` is Node 24+. Packaging, signing and a menu-bar tray
are not set up yet.

## Servers

**Add server** in the sidebar takes an SSH destination such as `steve@mac-server`.
Dock uses your existing keys in batch mode (it never prompts), so plain
`ssh steve@mac-server` must already work. Nothing is installed on the server; Dock
runs the `docker` CLI there. Leave the destination empty to watch this machine.

For each server Dock shows:

- **Apps.** Compose projects are grouped by name: `scout`, `scout-blue`, `scout-green`
  and `scout-hosted-blog` are one app. A `-blue`/`-green` or release-id suffix
  (`db3-site-20261009124935-7faa46a66fa1`) marks a **slot**. Each app card lists its
  routing (gateways, tunnels), its slots, its databases and anything else.
- **Roles** from each container's command: gateway, tunnel, web, API, queue worker
  (with its `--pool`), scheduler, database, backup.
- **Traffic.** Dock reads every nginx container's upstreams and `proxy_pass` targets
  (`nginx -T`) and resolves them through Docker network aliases, starting from
  containers on a public network (`edge`). What that reaches through `*_active` or
  direct routes is **Live**; what sits behind a `*_previous` upstream is **Standby**,
  the rollback target. A slot no gateway routes to is **Idle**.
- **Load:** CPU, memory, processes and network throughput, from the Engine API's
  exact counters (or `docker stats` where its socket or `curl` is unavailable).
- **Listening ports** from each container's own socket table (`/proc/net/tcp`),
  not the image's declared ports: Scout's workers share the API image, which
  declares 8787, but nothing in them listens. Images without `cat` (distroless,
  such as cloudflared) fall back to the declared ports, shown in italics.
- **Disk space:** used and free space on the server's own disk (its data volume
  and Docker root) in the header, and in each running container's **Details**,
  the filesystem behind every volume or bind-mounted folder as the container sees
  it, which on a Mac is the Docker VM's disk. Read with `df` every slow sample;
  images without `df` show nothing.
- **Requests:** nginx containers count requests from their access log since the last
  sample, leaving out their own health checks; tunnels report theirs from metrics.
- **Tunnels (cloudflared):** the latest ingress rules from the connector's log
  (`growthscout.io` → `http://growthscout:80` → the gateway container), edge
  connections, requests and errors from its metrics endpoint (port 20241, read
  from the host or from a neighbouring container with `wget`), and how often it
  re-registered edge connections in the last day. When ingress is known, traffic
  tracing starts at the tunnels, so only containers they really reach are Live.
- **Details** tab for the selected container: a tunnel's connections, response mix
  and ingress; a proxy's upstreams and every `location` with its target and error
  fallback (Scout's `/assets/` falls back to the previous slot); what routes into
  it, listening and declared ports, networks, release, restarts and health output.
- **Needs attention:** unhealthy or restarting containers, crashes in a live or
  standby slot, a standby slot whose API is down (a rollback would serve errors),
  a tunnel with fewer than 4 edge connections or frequent reconnects, ingress
  rules pointing at nothing, and any disk over 90% full or under 10 GB free
  (naming the database on it).
- **Activity** from `docker events`, so changes made by deploy scripts and restart
  policies appear within a second.
- **Logs:** select a container to follow `docker logs -f` below the list.

**Routes** (beside List, for a server) draws how requests reach containers with
[vue-flow](https://vueflow.dev): hostnames and published ports → tunnels → proxies
→ slots and containers, in fixed columns. Live routes move, previous upstreams
are dashed, and routes to nothing are red; lines into a blue or green slot take
that colour. A proxy's **Show rules** lists its nginx locations with their
fallbacks. **Show containers** opens a slot (routed or idle) into a box per
container, so a route lands on the container that serves it (blue web → blue
api). An open slot counts as selected: its routes stay lit, the rest fades, and
none of its containers fade while you hover or click among them; closing it lets go.
The diagram fits itself in view only when it first opens; after that it stays
where you put it, and **Fit** (top right) fits it again. **Box width** widens
every box and re-spaces the columns; wider boxes show more, such as CPU and memory after the request rate.
Containers in an open slot always show their CPU and memory on the right. The
panel below shows the selected container's load in its header. Every container box has restart and stop/start, with the list's prompts. The filter keeps only the paths through matching
names, following a shared tunnel only along the matching hostname. Hovering or
clicking any box (hostnames too) fades everything that is not on its routes, so
lines sharing a path can be followed; click it again, or the background, to let go.
Clicking a container's box also selects it in the panel below. The view is read-only and built entirely from the
server snapshot by `client/routes/buildRouteGraph.ts`; it lives in `client/routes/`
and `client/components/routes/`, so it can change or go without touching the rest.

A deployment can name its containers for every Dock with compose labels, shown in
the list and the diagram in place of the container name (which moves underneath):

```yaml
services:
  tunnel:
    labels:
      dock.title: Customer blog tunnel
      dock.description: Catch-all for customers' own blog domains
```

Start, stop and restart run `docker start|stop|restart`. Stopping honours the
container's stop timeout, so a worker can finish its job. Stop and restart always
ask first, saying when the container serves live traffic, is a database, or belongs
to a slot the deploy script manages.

Servers are sampled every 5s (details, routes and listening ports when containers
change, else every 30s; tunnel logs every 5 minutes), steps running in parallel on the host, only while a Dock window is open, through one multiplexed SSH connection
(control sockets in `~/.db3-dock/ssh`). Closing the last window stops sampling and the
remote `docker events`/`docker logs` processes after 15s. Environment variables of
containers are never read.

Servers are saved in `~/.db3-dock/hosts.json`. Two settings exist only there:

```json
{
	"version": 1,
	"hosts": [
		{
			"id": "mac-server",
			"name": "mac-server",
			"ssh": "steve@mac-server",
			"publicNetworks": ["edge"],
			"apps": [{ "name": "growthscout", "match": ["scout", "scout-*"] }]
		}
	]
}
```

`publicNetworks` names the networks whose members receive public traffic (default
`edge`); `apps` overrides grouping with `*` wildcards on compose project names.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOCK_CONFIG` | `~/.db3-dock/projects.json` | Saved projects and processes |
| `DOCK_HOSTS` | `hosts.json` beside `DOCK_CONFIG` | Saved servers |
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
  The server keeps the last 40 samples per process and container (two to three
  minutes) for the sparklines, so they are already drawn when the page opens.
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
server/   Dock (process manager), ProjectStore, SupervisedProcess, HTTP API;
          hosts/ watches Docker servers (HostMonitor, parsing, topology)
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
