import type { DocArticle } from '../docs';

/** User-facing Dock workflows, grounded in the standalone application's current UI. */
export const dockArticles: DocArticle[] = [
	{
		id: 'dock', area: 'dock', group: 'Dock', label: 'Getting started',
		title: 'Dock',
		summary: 'Your projects, processes and servers in one place. Run npm scripts with live terminals, then inspect Docker containers and the routes that reach them.',
		packageName: 'db3-dock', sourcePath: 'apps/dock/README.md',
		keywords: ['dock process manager terminal desktop electron setup'],
		steps: [
			{ title: 'Launch Dock', description: 'Run the browser UI from the framework repository.' },
			{ title: 'Add a project', description: 'Choose a folder containing your application’s package.json.' },
			{ title: 'Start your processes', description: 'Run the API, frontend and workers, and follow their output.' },
		],
		sections: [
			{ id: 'workspace', title: 'A workspace for your running apps', paragraphs: [
				'Dock replaces the terminal tabs you keep open for development. Each project has its own processes, Git branch, listening ports, CPU and memory readings. Select a process to see its terminal, or switch to Terminals to see several at once.',
				'The screenshots in this section show the current Dock interface with simulated example projects and server snapshots. Names, output and metrics are demonstration data.',
			], image: { src: '/framework/images/dock/processes.png', alt: 'Dock List view showing the example Workshop project, its API, web, queue and scheduler processes, and the selected API terminal.', caption: 'List view keeps process controls and the selected terminal together. Demonstration data.', width: 1440, height: 960 } },
			{ id: 'run', title: 'Launch Dock', paragraphs: [
				'Dock currently runs from the framework source repository. Use Node.js 24 or newer and npm. If you already have the checkout and dependencies, run just the final command below from the repository root.',
				'Open `http://127.0.0.1:5179` in your browser. The API listens on port 8790. Keep the launch terminal running while you use Dock.',
			], codeSampleId: 'dock-launch' },
			{ id: 'first-project', title: 'Add your first project', paragraphs: [
				'Choose Add project in the header and enter the folder containing your application’s `package.json`, for example `~/Sites/my-app`. Dock reads the scripts in that folder. In a monorepo, choose the application folder that owns the scripts you want to run.',
				'Dock adds the processes in `db3.app.json`, or else the `api`, `dev`, `web`, `queue`, `worker` and `scheduler` scripts that exist. Nothing starts automatically. Press Start on a process, or Start all on the project.',
				'Select a process row to open its output. Once it announces or opens a port, use the port link to open the application. The branch label shows which checkout you are running; change branches in your editor or Git client.',
			], links: [{ label: 'Run processes, add workers and use terminals', articleId: 'dock-processes' }] },
			{ id: 'create-app', title: 'Create a new app', paragraphs: [
				'Choose Add project → Create app to generate the db3 starter in a new folder. Enter an app name and parent folder, then choose MariaDB in Docker or a local MariaDB. Dock adds the generated project to your workspace.',
				'Select Install and migrate now to open a temporary setup terminal. For Docker, it starts the database; for a local database, it waits while you complete the DB_ settings in the generated .env. Setup then installs dependencies and runs the migrations. Start the web process when setup finishes.',
				'Use Node.js 24 or newer in the shell that launches Dock. If setup fails, read its terminal output and correct the reported configuration before running the setup commands again.',
			], links: [{ label: 'Explore the generated starter app', articleId: 'starter-app' }] },
			{ id: 'desktop', title: 'Use the desktop app', paragraphs: [
				'The Electron shell gives Dock its own desktop window. Install the shell’s separate dependencies once, then launch it from the repository root with the commands below. This starts the server, Vite and Electron with hot reload. Closing that development window stops the development stack.',
				'You can also choose Desktop app in the browser header. If the shell is not installed, Dock shows the installation command. Use a terminal whose PATH contains Node.js 24 or newer. Packaged installers, signing and a menu-bar tray are not set up yet.',
			], codeSampleId: 'dock-desktop' },
			{ id: 'built-server', title: 'Run without the development server', paragraphs: [
				'For a built browser UI, run `npm start --workspace db3-dock` from the repository root, then open `http://127.0.0.1:8790`. This builds the client and starts the local server.',
				'Dock listens on loopback because it can run commands on your machine. It is a local tool, not a hosted dashboard. Its server rejects non-loopback Host and Origin headers.',
			] },
		],
		codeSamples: [
			{ id: 'dock-launch', title: 'Run from the framework source', language: 'sh', code: 'git clone https://github.com/db3ai/framework.git db3-framework\ncd db3-framework\nnpm ci\nnpm run dev:dock' },
			{ id: 'dock-desktop', title: 'Install and launch the desktop shell', language: 'sh', code: 'npm install --prefix apps/dock/electron --workspaces=false\nnpm run dev:dock:electron' },
		],
		relatedIds: ['dock-processes', 'dock-servers', 'starter-app'],
	},
	{
		id: 'dock-processes', area: 'dock', group: 'Dock', label: 'Projects & terminals',
		title: 'Run projects and processes',
		summary: 'Start your development stack, add queue workers and work directly in each process’s terminal.',
		packageName: 'db3-dock', sourcePath: 'apps/dock/README.md',
		keywords: ['dock npm scripts workers queue pools scheduler terminal output ports'],
		sections: [
			{ id: 'controls', title: 'Start, stop and restart', paragraphs: [
				'Select a project in the sidebar, or use All projects to see the workspace. Each row shows a process’s status, command, uptime, ports and resource usage. Start launches its npm script in the project folder. Stop sends a termination signal to the process group, then force-stops it after eight seconds if it has not exited. Restart stops it and launches it again.',
				'Stopped means the process finished successfully, was stopped deliberately or received Ctrl-C. Exited with a non-zero code indicates a failure: select the process and inspect its output before restarting. Dock does not currently auto-restart crashed local workers.',
				'Port links come from the process’s output or listening sockets. If Caddy’s local admin API is available, Dock can show the corresponding local domain. A running process without a port link may simply be a worker or scheduler that does not listen for HTTP requests.',
			] },
			{ id: 'terminals', title: 'Work in live terminals', paragraphs: [
				'Choose Terminals in the header to put process terminals side by side. Click inside a pane to type, answer prompts or use the tool’s own shortcuts. Ctrl-C interrupts the process; Cmd/Ctrl+K clears the terminal; Cmd/Ctrl+click opens a link.',
				'Drag pane boundaries to adjust the layout, or expand a terminal when you need more room. Dock keeps about 1 MB of scrollback per process. If the same process is open in several panes, the last pane resized determines the terminal size.',
			], image: { src: '/framework/images/dock/terminals.png', alt: 'Dock Terminals view displaying API, web, queue and scheduler output in separate panes for the Workshop example project.', caption: 'Terminals view shows the development stack side by side. Output is simulated demonstration data.', width: 1440, height: 960 } },
			{ id: 'add-process', title: 'Add a worker or another script', paragraphs: [
				'Choose Add process for a project. Pick a queue worker, scheduler or another npm script found in its `package.json`. For queue workers, choose specific queues, all queues except selected names, or a named pool. Queue and pool suggestions come from a static scan of the application’s source.',
				'Set the name and number of processes, review the command preview, then choose whether to save them and start them immediately. Queue and scheduler scripts receive `queue:work` or `scheduler:work` unless the script already contains the command.',
				'Leave Save to project selected to retain the process definition in Dock’s configuration. Untick it for a process that should exist only until Dock exits. Dock runs scripts that already exist in your project; add a new script to `package.json` first if it is not listed.',
			], links: [{ label: 'Configure queues and worker pools', articleId: 'queue-overview' }, { label: 'Schedule recurring work', articleId: 'scheduler' }] },
			{ id: 'outside-dock', title: 'Processes started outside Dock', paragraphs: [
				'Dock also discovers matching npm scripts already running in a terminal or editor. These show as outside Dock. Their status, PID, uptime, CPU, memory and ports are visible, but output stays in the terminal that started them.',
				'Stop ends an external process. Restart takes over by launching it inside Dock with live output. Removing a project or quitting Dock leaves processes started outside Dock running. Matching uses the project folder and script name; npm’s process title does not preserve script arguments.',
			] },
			{ id: 'preferences', title: 'Saved projects and preferences', paragraphs: [
				'Projects and saved processes live in `~/.db3-dock/projects.json` by default. Set `DOCK_CONFIG` to use a different file. `DOCK_AUTOSTART=1` starts every saved process when Dock launches; leave it unset when you want to choose what starts.',
				'Use the header theme control for light, dark or system appearance. Open in editor uses Cursor by default; set `DOCK_EDITOR=code` or another editor command before launching Dock to change it. Set `DOCK_PORT` and `DOCK_CLIENT_PORT` if ports 8790 or 5179 are already occupied.',
			] },
		],
		relatedIds: ['dock', 'dock-servers', 'queue-overview'],
	},
	{
		id: 'dock-servers', area: 'dock', group: 'Dock', label: 'Servers & routes',
		title: 'Inspect servers and follow traffic',
		summary: 'Connect to a Docker host, inspect its apps and containers, and trace the routes into live and standby deployments.',
		packageName: 'db3-dock', sourcePath: 'apps/dock/README.md',
		keywords: ['dock docker ssh servers containers routes blue green logs nginx'],
		sections: [
			{ id: 'connect', title: 'Add a server', paragraphs: [
				'Choose Add server in the sidebar, give it a name and enter an SSH destination such as `deploy@example-server`. Leave the destination empty to inspect Docker on this machine. Dock uses your existing SSH keys in batch mode, so the connection must already work without a password prompt.',
				'The destination account needs permission to run Docker. Dock runs the Docker CLI over SSH and does not install an agent on the host. If the connection fails, check SSH authentication, the destination name and Docker access from your terminal first.',
				'Servers are saved in `~/.db3-dock/hosts.json` by default. Set `DOCK_HOSTS` to change the path. Sampling runs while a Dock window is open; it stops shortly after the last window closes.',
			] },
			{ id: 'inspect', title: 'Read the server overview', paragraphs: [
				'Select the server to see containers grouped by application and deployment slot. List view shows routing containers, blue/green or release slots, databases and other services. Select a container for Details, or choose Logs to follow its output.',
				'Live means Dock traced an active route to the container. Standby means it is behind a previous upstream, typically a rollback target. An unrouted slot is Idle. These labels describe the routes Dock can inspect; check health and logs as well when assessing a deployment.',
				'CPU, memory, network throughput, listening ports and disk readings help explain load. Needs attention highlights conditions such as unhealthy containers, a stopped standby API, broken routing and low disk space. Missing metrics mean the host or container could not supply them, not necessarily zero usage.',
			], image: { src: '/framework/images/dock/servers.png', alt: 'Dock server overview grouping an example application into routing, live blue and standby green slots, and a shared database.', caption: 'The server overview highlights a stopped standby API that needs attention. Demonstration data.', width: 1440, height: 960 } },
			{ id: 'routes', title: 'Trace a request through Routes', paragraphs: [
				'Choose Routes beside List. The diagram connects entry points, tunnels, proxies and deployment slots to the containers that receive traffic. Active routes animate, previous upstreams are dashed and unresolved destinations appear in red.',
				'Click or hover a box to highlight its paths. Click it again or click the background to clear the selection. Use Show rules on a proxy to inspect nginx locations and fallbacks, and Show containers on a slot to expand its individual containers. Selecting a container also selects it in the panel below.',
				'Filter by name to focus on a path. Pan and zoom to explore; Fit brings the diagram back into view. Box width makes nodes wider when you want to read more detail.',
			], image: { src: '/framework/images/dock/routes.png', alt: 'Dock Routes diagram showing an example gateway connected to live blue and standby green deployment slots.', caption: 'Routes makes active and previous upstreams visible. This is a simulated Docker topology, not a live deployment.', width: 1440, height: 960 } },
			{ id: 'actions', title: 'Use container controls deliberately', paragraphs: [
				'Start, stop and restart run Docker commands on the selected host. Stop and restart ask for confirmation and identify live traffic, databases and slots managed by deployment scripts. Read the prompt before continuing. Stop honours the container’s configured stop timeout.',
				'The route diagram visualises the sampled configuration; it does not edit routing or deploy a new release. Its container controls still perform real operations. Use your deployment workflow for release promotion and rollback.',
			] },
			{ id: 'limits', title: 'Understand what Dock can observe', paragraphs: [
				'Dock traces nginx upstreams and Cloudflare Tunnel ingress through Docker network aliases. The default public network is `edge`; advanced deployments can change `publicNetworks` and application grouping in the saved hosts file.',
				'Hosts are normally sampled every five seconds, with slower refreshes for route details and tunnel logs. Container events make many changes appear sooner. Treat the screen as the most recent observation, rather than a guarantee that a service is reachable from every client.',
				'Dock does not read container environment variables. Logs and container details can still contain application data, so review them before sharing a screenshot.',
			] },
		],
		relatedIds: ['dock', 'dock-processes'],
	},
];
