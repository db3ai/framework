import { z } from 'zod';
import { InAppError } from './InAppError';
import type * as inbox from './contracts';

const identifier = z.string().min(1).max(255).regex(/^\S+$/u);
const scopeSchema = z.union([
	z.object({ type: z.literal('account') }).strict(),
	z.object({ type: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/).refine(value => value !== 'account'), id: identifier }).strict(),
]);
const messageSchema = z.object({
	title: z.string().trim().min(1).max(255),
	body: z.string().trim().min(1).max(10_000),
	bodyHtml: z.string().trim().min(1).max(50_000).optional(),
	severity: z.enum(['info', 'success', 'warning', 'error']).default('info'),
	presentation: z.enum(['inbox', 'toast', 'banner']).default('toast'),
	action: z.object({ label: z.string().trim().min(1).max(120), href: z.string().min(1).max(2048).refine(safeAction) }).strict().optional(),
}).strict();
const sendSchema = z.object({ scope: scopeSchema, type: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/), key: z.string().min(1).max(255).optional() }).strict();
const querySchema = z.object({ scope: scopeSchema, limit: z.number().int().min(1).max(100).default(25), before: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(), view: z.enum(['inbox', 'banners']).default('inbox') }).strict();

/** Accepts local absolute paths and credential-free HTTP(S) URLs, rejecting executable and ambiguous forms. */
function safeAction(value: string): boolean {
	if (/[\s\\\u0000-\u001f\u007f]/u.test(value)) return false;
	if (value.startsWith('/') && !value.startsWith('//')) return true;
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
	} catch { return false; }
}

/** Parses public input without leaking database or recipient information. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
	const result = schema.safeParse(value);
	if (!result.success) throw new InAppError('invalid', 'Invalid in-app message input.');
	return result.data;
}

/** Copies and validates content before it can be persisted. */
export function normalizeMessage(value: inbox.InAppMessage): inbox.InAppMessage { return parse(messageSchema, value); }
/** Validates the explicit dispatch scope, type and retry identity. */
export function normalizeSend(value: inbox.InAppSendOptions): inbox.InAppSendOptions { return parse(sendSchema, value); }
/** Validates a scoped inbox query and resolves pagination defaults. */
export function normalizeQuery(value: inbox.InAppInboxQuery) { return parse(querySchema, value); }
/** Validates a scope for state-changing operations. */
export function normalizeScope(value: inbox.InAppScope): inbox.InAppScope { return parse(scopeSchema, value); }
/** Validates the bounded recipient list and removes repeated identities. */
export function normalizeRecipients(value: string | readonly string[]): string[] {
	return [...new Set(parse(z.array(identifier).max(100), typeof value === 'string' ? [value] : value))];
}
