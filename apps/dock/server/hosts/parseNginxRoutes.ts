/** A `location` inside a `server` block. */
export interface NginxLocation {
	/** Modifier and path, such as `/assets/`, `^~ /_internal/` or `@previous_assets`. */
	path: string;
	/** Host, upstream or `$variable` from `proxy_pass`, without scheme and port. */
	proxyPass: string | null;
	/** `return` directive, such as `404` or `200 "healthy"`. */
	returns: string | null;
	/** Named location this one falls back to on errors (`error_page … = @name`). */
	fallback: string | null;
}

/** A `server` block: what it listens on and how it routes. */
export interface NginxServer {
	listen: string[];
	names: string[];
	locations: NginxLocation[];
}

/** Where an nginx container sends requests, read from `nginx -T`. */
export interface NginxRoutes {
	/** Upstream blocks: name to `host` targets (ports dropped). */
	upstreams: Map<string, string[]>;
	/** Hosts named directly in `proxy_pass`, plus upstream names it uses. */
	proxyPasses: string[];
	servers: NginxServer[];
}

interface Directive {
	name: string;
	args: string[];
	children: Directive[] | null;
}

/**
 * Parses nginx configuration (the output of `nginx -T`) into upstreams, proxy
 * targets and server blocks. Only the names matter: they are resolved against
 * Docker network aliases later.
 *
 * @param config - nginx configuration text.
 * @returns Upstreams, proxy targets and servers.
 */
export function parseNginxRoutes(config: string): NginxRoutes {
	const tree = parseDirectives(tokenize(config));
	const upstreams = new Map<string, string[]>();
	const proxyPasses = new Set<string>();
	const servers: NginxServer[] = [];

	const walk = (directives: Directive[]) => {
		for (const directive of directives) {
			if (directive.name === 'upstream' && directive.children) {
				const hosts = directive.children.filter(child => child.name === 'server' && child.args[0]).map(child => hostOf(child.args[0]!));
				upstreams.set(directive.args[0] ?? '', [...new Set(hosts.filter(Boolean))]);
			} else if (directive.name === 'server' && directive.children) {
				servers.push(readServer(directive.children));
			} else if (directive.name === 'proxy_pass') {
				const host = proxyHost(directive.args[0]);
				if (host && !host.startsWith('$')) proxyPasses.add(host);
			}
			// `types` blocks (mime.types) and the like hold nothing about routing.
			if (directive.children && directive.name !== 'types') walk(directive.children);
		}
	};
	walk(tree);
	return { upstreams, proxyPasses: [...proxyPasses], servers };
}

function readServer(children: Directive[]): NginxServer {
	const server: NginxServer = { listen: [], names: [], locations: [] };
	for (const child of children) {
		if (child.name === 'listen') server.listen.push(child.args.join(' '));
		else if (child.name === 'server_name') server.names.push(...child.args);
		else if (child.name === 'location' && child.children) {
			const find = (name: string) => child.children!.find(item => item.name === name);
			const errorPage = child.children.find(item => item.name === 'error_page' && item.args.at(-1)?.startsWith('@'));
			server.locations.push({
				path: child.args.join(' '),
				proxyPass: proxyHost(find('proxy_pass')?.args[0]),
				returns: find('return')?.args.join(' ') ?? null,
				fallback: errorPage?.args.at(-1) ?? null,
			});
		}
	}
	return server;
}

/** Splits nginx syntax into words, `{`, `}` and `;`, dropping comments and honouring quotes. */
function tokenize(text: string): string[] {
	const tokens: string[] = [];
	let index = 0;
	while (index < text.length) {
		const char = text[index]!;
		if (/\s/.test(char)) {
			index++;
		} else if (char === '#') {
			while (index < text.length && text[index] !== '\n') index++;
		} else if (char === '{' || char === '}' || char === ';') {
			tokens.push(char);
			index++;
		} else if (char === '"' || char === "'") {
			let end = index + 1;
			while (end < text.length && text[end] !== char) end += text[end] === '\\' ? 2 : 1;
			tokens.push(text.slice(index + 1, end));
			index = end + 1;
		} else {
			let end = index;
			while (end < text.length && !/[\s{};]/.test(text[end]!)) end++;
			tokens.push(text.slice(index, end));
			index = end;
		}
	}
	return tokens;
}

function parseDirectives(tokens: string[]): Directive[] {
	let position = 0;
	const block = (): Directive[] => {
		const directives: Directive[] = [];
		let words: string[] = [];
		while (position < tokens.length) {
			const token = tokens[position++]!;
			if (token === ';') {
				if (words.length) directives.push({ name: words[0]!, args: words.slice(1), children: null });
				words = [];
			} else if (token === '{') {
				directives.push({ name: words[0] ?? '', args: words.slice(1), children: block() });
				words = [];
			} else if (token === '}') {
				return directives;
			} else {
				words.push(token);
			}
		}
		return directives;
	};
	return block();
}

/**
 * Blue/green role of an upstream from its name: `scout_active` or `db3_docs_previous`.
 *
 * @param name - Upstream name.
 * @returns `active`, `previous`, or `direct` for any other upstream.
 */
export function upstreamRole(name: string): 'active' | 'previous' | 'direct' {
	if (/(^|[_-])(active|live|current)$/.test(name)) return 'active';
	if (/(^|[_-])(previous|standby|backup|old)$/.test(name)) return 'previous';
	return 'direct';
}

function proxyHost(target: string | undefined): string | null {
	const match = target ? /^https?:\/\/([^/\s]+)/.exec(target) : null;
	return match ? hostOf(match[1]!) || null : null;
}

function hostOf(target: string): string {
	return target.replace(/^unix:.*$/, '').replace(/:\d+$/, '');
}
