/** Transport-neutral authenticated request passed to an app-owned route. */
export interface AppRouteContext<TService> {
	service: TService;
	/** Identity established by the host adapter; never taken from a request body. */
	actor: { id: string };
	body: unknown;
	params: Readonly<Record<string, string>>;
	query: Readonly<Record<string, unknown>>;
}

/** One route mounted beneath /api/apps/{appId}; authorization remains mandatory in the adapter. */
export interface AppRoute<TService = unknown> {
	method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	path: string;
	/** HTTP success status; defaults to 200. */
	status?: number;
	handle(context: AppRouteContext<TService>): unknown | Promise<unknown>;
}
