import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell, type MenuItemConstructorOptions } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureDockServer, type DockServerHandle } from './dockServer.js';
import { externalUrl, isDockNavigation, isLoopbackHttpUrl } from './navigation.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/src/main.js → apps/dock
const dockDir = resolve(here, '..', '..', '..');
const port = Number(process.env.DOCK_PORT || 8790);

app.setName('Dock');
app.enableSandbox();
// The profile also scopes the single-instance lock, so `npm run dev:dock:electron`
// (profile `db3-dock-electron-dev`) opens beside a regular Dock window instead of handing off to it.
app.setPath('userData', join(app.getPath('appData'), profileName(process.env.DOCK_ELECTRON_PROFILE)));

/**
 * @param requested - Profile name from the environment.
 * @returns A safe folder name for Electron's user data.
 */
function profileName(requested: string | undefined): string {
	return requested && /^[a-z0-9][a-z0-9-]{0,63}$/.test(requested) ? requested : 'db3-dock-electron';
}

let server: DockServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

/**
 * The address to show: `DOCK_UI_URL` when Dock's web UI launched this window
 * (the Vite dev server in development), else the Dock server itself.
 */
function uiUrl(serverUrl: string): string {
	const requested = process.env.DOCK_UI_URL;
	return requested && isLoopbackHttpUrl(requested) ? requested : serverUrl;
}

function openExternal(url: string): void {
	const safe = externalUrl(url);
	if (safe) void shell.openExternal(safe).catch(() => console.warn('Unable to open the external browser.'));
}

/** Creates the sandboxed window onto the local Dock UI. */
function createWindow(appUrl: string): void {
	const window = new BrowserWindow({
		title: 'Dock',
		width: 1320,
		height: 880,
		minWidth: 560,
		minHeight: 480,
		// Matches the page's first paint for the system theme (the --ground token).
		backgroundColor: nativeTheme.shouldUseDarkColors ? '#121316' : '#f4f5f7',
		webPreferences: {
			partition: 'persist:dock',
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
			devTools: !app.isPackaged,
		},
	});
	mainWindow = window;
	window.on('closed', () => {
		mainWindow = null;
	});
	window.webContents.on('will-attach-webview', event => event.preventDefault());
	window.webContents.on('will-frame-navigate', event => {
		if (isDockNavigation(event.url, appUrl)) return;
		event.preventDefault();
		if (event.isMainFrame) openExternal(event.url);
	});
	// Port links (target=_blank) and any other new windows open in the system browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		openExternal(url);
		return { action: 'deny' };
	});
	void window.loadURL(appUrl);
}

function activate(): void {
	if (!server) return;
	if (!mainWindow) createWindow(uiUrl(server.url));
	else {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', activate);
	app.on('activate', activate);
	// macOS apps usually stay open without windows, but closing the dev window ends the dev session.
	const devSession = process.env.DOCK_ELECTRON_PROFILE === 'db3-dock-electron-dev';
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin' || devSession) app.quit();
	});
	// Ctrl-C in the terminal, or a process manager stopping it, quits cleanly.
	for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
	// Stop the Dock server (and so every supervised process) before exiting.
	app.on('before-quit', event => {
		if (quitting || !server) return;
		event.preventDefault();
		quitting = true;
		void server.stop().finally(() => app.quit());
	});

	void app.whenReady().then(async () => {
		const dockSession = session.fromPartition('persist:dock');
		dockSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
		dockSession.setPermissionCheckHandler(() => false);
		dockSession.on('will-download', event => event.preventDefault());
		const menus: MenuItemConstructorOptions[] = [
			...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : [{ label: 'File', submenu: [{ role: 'quit' as const }] }]),
			{ role: 'editMenu' },
			{ label: 'View', submenu: [
				{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
				...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
			] },
			{ role: 'windowMenu' },
		];
		Menu.setApplicationMenu(Menu.buildFromTemplate(menus));
		server = await ensureDockServer({ dockDir, port });
		createWindow(uiUrl(server.url));
	}).catch(error => {
		dialog.showErrorBox('Dock could not start', error instanceof Error ? error.message : String(error));
		app.exit(1);
	});
}
