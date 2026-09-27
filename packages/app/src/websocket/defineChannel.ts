import type { WebSocketChannelDefinition } from './contracts/WebSocketChannel';

/**
 * Defines a private resource channel with an explicit application access policy.
 * @param pattern - Colon-delimited name with optional {parameter} segments.
 * @param options - Access check using the freshly authenticated user and resource parameters.
 * @returns A definition to include in an endpoint's channels array.
 */
export function defineChannel(pattern: string, options: Omit<WebSocketChannelDefinition, 'pattern'>): WebSocketChannelDefinition {
	const segments = pattern.split(':');
	const parameters = segments.filter(segment => segment.startsWith('{'));
	if (pattern.length > 256 || !segments.every(segment => /^[a-zA-Z0-9_.-]+$/.test(segment) || /^\{[a-zA-Z][a-zA-Z0-9_]*\}$/.test(segment)) || new Set(parameters).size !== parameters.length || typeof options.authorize !== 'function') throw new Error('Invalid channel definition.');
	return Object.freeze({ pattern, authorize: options.authorize });
}
