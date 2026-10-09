/** App-owned settings compiled into the desktop shell, independent of server secrets. */
export const desktopConfig = {
	name: 'DB3 Starter',
	// Match APP_ORIGIN exactly; localhost and 127.0.0.1 have different cookies.
	url: 'http://localhost:5173',
	// This experiment runs against local Vite. Use HTTPS and false for a hosted build.
	allowLocalHttp: true,
};
