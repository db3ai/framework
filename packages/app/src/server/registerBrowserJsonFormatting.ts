import type { FastifyInstance, FastifyReply } from 'fastify';

const MAX_PRETTY_JSON_CHARS = 1_000_000;
const MAX_PRETTY_JSON_DEPTH = 64;
const MAX_FORMATTED_JSON_CHARS = 4_000_000;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;
const JSON_TOKENS = /"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g;
const BODY_PRESERVING_HEADERS = ['content-encoding', 'content-disposition', 'etag', 'content-digest', 'digest', 'content-md5'];

/**
 * Formats small JSON responses for browser page navigations across a Fastify server.
 *
 * Register before routes and plugins so their replies inherit the send hook. The
 * hook runs after Fastify response-schema serialization and only reformats GET
 * requests with `Sec-Fetch-Mode: navigate`. Browser fetches, other methods,
 * streams, encoded bodies, and responses with integrity headers retain their
 * original bytes. Large JSON bodies remain compact to bound browser-only work.
 *
 * @param server - Fastify server that owns the response lifecycle.
 * @example
 * const server = Fastify();
 * registerBrowserJsonFormatting(server);
 */
export function registerBrowserJsonFormatting(server: FastifyInstance): void {
	server.addHook('onSend', (request, reply, payload, done) => {
		if (request.method !== 'GET' || typeof payload !== 'string' || payload.length > MAX_PRETTY_JSON_CHARS) return done(null, payload);
		const contentType = reply.getHeader('content-type');
		if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE.test(contentType)) return done(null, payload);
		if (BODY_PRESERVING_HEADERS.some(header => reply.hasHeader(header))) return done(null, payload);

		varyByFetchMode(reply);
		if (request.headers['sec-fetch-mode'] !== 'navigate') return done(null, payload);

		try {
			JSON.parse(payload);
			const formatted = formatJsonTokens(payload);
			if (formatted === payload) return done(null, payload);
			reply.removeHeader('content-length');
			return done(null, formatted);
		} catch {
			return done(null, payload);
		}
	});
}

/**
 * Inserts spacing around validated JSON tokens without changing numeric or string literals.
 *
 * @param source - Valid serialized JSON whose original value tokens must be retained.
 * @returns Indented JSON, or the original body when depth or output limits are reached.
 */
function formatJsonTokens(source: string): string {
	const tokens = source.match(JSON_TOKENS);
	if (!tokens) return source;
	let depth = 0;
	let formatted = '';

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]!;
		if (token === '{' || token === '[') {
			const next = tokens[index + 1];
			if (next === (token === '{' ? '}' : ']')) {
				formatted += token + next;
				index++;
			} else {
				if (depth >= MAX_PRETTY_JSON_DEPTH) return source;
				formatted += token + '\n' + '  '.repeat(++depth);
			}
		} else if (token === '}' || token === ']') {
			formatted += '\n' + '  '.repeat(--depth) + token;
		} else if (token === ',') {
			formatted += ',\n' + '  '.repeat(depth);
		} else if (token === ':') {
			formatted += ': ';
		} else {
			formatted += token;
		}
		if (formatted.length > MAX_FORMATTED_JSON_CHARS) return source;
	}

	return formatted;
}

/**
 * Keeps cached compact and browser-readable JSON variants separate.
 *
 * @param reply - Response whose existing Vary fields must be preserved.
 */
function varyByFetchMode(reply: FastifyReply): void {
	const existing = reply.getHeader('vary');
	const values = existing === undefined ? '' : String(existing);
	if (values === '*' || values.split(',').some(value => value.trim().toLowerCase() === 'sec-fetch-mode')) return;
	reply.header('vary', values ? `${values}, Sec-Fetch-Mode` : 'Sec-Fetch-Mode');
}
