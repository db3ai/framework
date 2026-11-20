import type { ZodType } from 'zod';
import type { AppRoute, AppRouteContext } from './contracts';
import { AppRouteError } from './AppRouteError';

/** Parses one part of a request with the route's schema, refusing it with the first problem found. */
function parse(schema: ZodType | undefined, value: unknown, part: string) {
	if (!schema) return value;
	const parsed = schema.safeParse(value ?? {});
	if (parsed.success) return parsed.data;
	const issue = parsed.error.issues[0]!;
	const where = [part, ...issue.path.map(String)].join('.');
	throw new AppRouteError(400, `${where}: ${issue.message}`);
}

/**
 * Runs a route's handler after checking the request against its declared input. HTTP and AI tool
 * calls both go through here, so a route accepts exactly the same calls from people and agents.
 */
export async function callAppRoute<TService>(route: AppRoute<TService>, context: AppRouteContext<TService>): Promise<unknown> {
	const input = route.input;
	return route.handle(input ? {
		...context,
		params: parse(input.params, context.params, 'params') as AppRouteContext<TService>['params'],
		query: parse(input.query, context.query, 'query') as AppRouteContext<TService>['query'],
		body: parse(input.body, context.body, 'body'),
	} : context);
}
