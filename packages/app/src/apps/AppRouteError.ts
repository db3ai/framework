/** Deliberately public HTTP failure from an app route. Other errors remain private to server logs. */
export class AppRouteError extends Error {
	/** Creates a safe client-facing error; use only for expected validation and access failures. */
	constructor(readonly statusCode: 400 | 401 | 403 | 404 | 409 | 503, message: string) {
		super(message);
		this.name = 'AppRouteError';
	}
}
