import { SSR_APP_MARKER, SSR_HEAD_MARKER, SSR_STATE_MARKER } from './constants';
import type { SsrRenderContext, SsrRenderResult } from './contracts';
import { renderDocumentHead } from './renderDocumentHead';
import { serializeSsrState } from './serializeSsrState';

/**
 * Assembles a complete HTML document from an application render result.
 *
 * The application marker is required because omitting rendered content would
 * silently turn a server-rendered page into an empty client-only shell. Head and
 * state markers are optional for deliberately non-hydrated documents.
 *
 * @param template - Application-owned HTML document shell.
 * @param context - Request-owned metadata collected during rendering.
 * @param result - Application markup and optional response overrides.
 * @returns Complete HTML document ready for the HTTP response.
 */
export function renderSsrDocument<TState extends object>(
	template: string,
	context: SsrRenderContext<TState>,
	result: SsrRenderResult<TState>,
): string {
	if (!template.includes(SSR_APP_MARKER)) {
		throw new Error(`SSR template must contain ${SSR_APP_MARKER}.`);
	}

	const values: Record<string, string> = {
		[SSR_HEAD_MARKER]: renderDocumentHead(result.head ?? context.head),
		[SSR_APP_MARKER]: result.appHtml,
		[SSR_STATE_MARKER]: serializeSsrState(result.state ?? context.state),
	};
	// Replace template markers once. Callback values keep $&/$`/$' literal and
	// prevent marker-like content in rendered HTML from becoming template input.
	return template.replace(/<!--platform-ssr-(?:head|app|state)-->/g, marker => values[marker]!);
}
