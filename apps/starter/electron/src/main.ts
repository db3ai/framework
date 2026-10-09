import { app, BrowserWindow, Menu, session, shell, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { desktopConfig } from './desktop.config.js';
import { externalWebUrl, isAppNavigation, resolveAppUrl } from './navigationPolicy.js';

app.setName(desktopConfig.name);
app.enableSandbox();
// A dedicated profile prevents this experiment sharing another Electron app's session.
app.setPath('userData', !app.isPackaged && process.env.DB3_ELECTRON_PROFILE
	? process.env.DB3_ELECTRON_PROFILE
	: join(app.getPath('appData'), 'db3-starter-electron'));

const appUrl = resolveAppUrl(!app.isPackaged && process.env.DB3_ELECTRON_URL || desktopConfig.url, desktopConfig.allowLocalHttp);
const offlineUrl = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>DB3 Starter — Unable to connect</title><style>
body { font: 16px system-ui; color: #17212f; background: #f6f7f9; padding: 12vh 8vw; }
main { max-width: 520px; margin: auto; } p { line-height: 1.6; color: #526071; }
a { display: inline-block; background: #17212f; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; }
</style></head><body><main><h1>Unable to connect</h1>
<p>Check your connection and make sure the starter server is running, then try again.</p>
<a href="db3-starter-retry:">Try again</a></main></body></html>`)}`;
let mainWindow: BrowserWindow | null = null;

/** Opens a validated ordinary web link outside the privileged application window. */
function openExternal(destination: string): void {
	const url = externalWebUrl(destination);
	if (url) void shell.openExternal(url).catch(() => console.warn('Unable to open the external browser.'));
}

/** Presents a local recovery screen without requiring a network response or native bridge. */
function showOffline(window: BrowserWindow): void {
	if (!window.isDestroyed() && window.webContents.getURL() !== offlineUrl) {
		void window.loadURL(offlineUrl).catch(() => console.warn('Unable to display the connection screen.'));
	}
}

/** Loads the shared frontend, retaining a retry path when the server cannot be reached. */
function loadApp(window: BrowserWindow): void {
	void window.loadURL(appUrl).catch(() => showOffline(window));
}

/** Creates the single sandboxed web client with an independent persistent cookie session. */
function createWindow(): void {
	const window = new BrowserWindow({
		title: desktopConfig.name,
		width: 1280,
		height: 850,
		minWidth: 480,
		minHeight: 480,
		backgroundColor: '#f6f7f9',
		webPreferences: {
			partition: 'persist:starter',
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
			devTools: !app.isPackaged,
		},
	});
	mainWindow = window;
	window.on('closed', () => { mainWindow = null; });
	window.webContents.on('will-attach-webview', event => event.preventDefault());
	window.webContents.on('will-frame-navigate', event => {
		if (event.isMainFrame && event.url === 'db3-starter-retry:' && window.webContents.getURL() === offlineUrl) {
			event.preventDefault();
			loadApp(window);
			return;
		}
		if (isAppNavigation(event.url, appUrl)) return;
		event.preventDefault();
		if (event.isMainFrame && isAppNavigation(window.webContents.getURL(), appUrl)) openExternal(event.url);
	});
	// Redirects never open a browser automatically or escape the trusted origin.
	window.webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
		if (isAppNavigation(url, appUrl)) return;
		event.preventDefault();
		if (isMainFrame) showOffline(window);
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isAppNavigation(window.webContents.getURL(), appUrl)) {
			if (isAppNavigation(url, appUrl)) void window.loadURL(url).catch(() => showOffline(window));
			else openExternal(url);
		}
		return { action: 'deny' };
	});
	window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
		if (isMainFrame && code !== -3) showOffline(window);
	});
	window.webContents.on('render-process-gone', () => showOffline(window));
	loadApp(window);
}

/** Focuses the existing window, or recreates it after macOS closes its last window. */
function activate(): void {
	if (!mainWindow) createWindow();
	else {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => { if (app.isReady()) activate(); });
	app.on('activate', () => { if (app.isReady()) activate(); });
	app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
	void app.whenReady().then(() => {
		const clientSession = session.fromPartition('persist:starter');
		clientSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
		clientSession.setPermissionCheckHandler(() => false);
		clientSession.on('will-download', event => event.preventDefault());
		const menus: MenuItemConstructorOptions[] = [
			...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : [{ label: 'File', submenu: [{ role: 'quit' as const }] }]),
			{ role: 'editMenu' },
			{ label: 'View', submenu: [
				{ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow) loadApp(mainWindow); } },
				{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
				...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
			] },
			{ role: 'windowMenu' },
		];
		Menu.setApplicationMenu(Menu.buildFromTemplate(menus));
		createWindow();
	}).catch(error => {
		console.error('Unable to start DB3 Starter:', error instanceof Error ? error.message : 'unknown error');
		app.exit(1);
	});
}
