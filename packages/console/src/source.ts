/**
 * Where the console screens send their requests. Every screen speaks the console contract from
 * `@db3.ai/app/console`; only the address in front of it changes. Dock points it at its own
 * server, which opens the project from its folder, and db3 Cloud at its own console routes.
 */
export interface ConsoleSource {
	/** Reads JSON from a console path such as `database/tables`. */
	get<T>(path: string): Promise<T>;
	/** Sends JSON and reads the JSON answer. */
	send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>;
	/** Uploads raw bytes, as storage file uploads do. */
	upload(path: string, body: Blob): Promise<void>;
	/** A URL the browser can open directly, for downloads and thumbnails. */
	url(path: string): string;
}

/** A refusal from the console API, with its message. */
export class ConsoleRequestError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
		this.name = 'ConsoleRequestError';
	}
}

/**
 * Creates a source that calls the console over HTTP.
 *
 * @param base - Address in front of the console paths, such as `/api/projects/<id>/console`.
 * @param options - Extra headers (a token, when the browser may hold one) and a fetch for tests.
 * @returns The source.
 */
export function httpConsoleSource(base: string, options: { headers?: Record<string, string>; fetch?: typeof fetch } = {}): ConsoleSource {
	const root = base.replace(/\/+$/, '');
	const call = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
	const address = (path: string) => `${root}/${path.replace(/^\/+/, '')}`;
	async function request<T>(method: string, path: string, body?: BodyInit, type?: string): Promise<T> {
		const response = await call(address(path), { method, credentials: 'same-origin', headers: { ...options.headers, ...(type ? { 'content-type': type } : {}) }, body });
		const data = await response.json().catch(() => ({}));
		if (!response.ok) throw new ConsoleRequestError((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `The request failed (${response.status}).`, response.status);
		return data as T;
	}
	return {
		get: path => request('GET', path),
		send: (method, path, body) => request(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? undefined : 'application/json'),
		upload: async (path, body) => { await request('PUT', path, body, 'application/octet-stream'); },
		url: address,
	};
}
