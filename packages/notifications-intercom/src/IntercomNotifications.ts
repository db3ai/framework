import { IntercomDeliveryError } from './IntercomDeliveryError.js';
import type { IntercomMessage } from './IntercomMessage.js';

/** Event fields available for Intercom message personalization; no arbitrary user records. */
export type IntercomEventMetadata = Record<string, string | number>;

/** Server-only configuration for admin-initiated Messenger messages. */
export interface IntercomNotificationsOptions {
	accessToken: string;
	adminId?: string;
	/** One total deadline across contact resolution and message submission; default ten seconds. */
	timeoutMs?: number;
}

/** Sends notifications exclusively to Intercom Messenger, using the canonical application user ID. */
export class IntercomNotifications {
	readonly #options: IntercomNotificationsOptions;

	/** Keeps credentials private; missing configuration is reported only when delivery is requested. */
	constructor(options: IntercomNotificationsOptions) {
		if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000)) throw new Error('Intercom timeout must be between 1 and 30000 milliseconds.');
		this.#options = { ...options };
	}

	/** Posts a named event for a message authored and activated in Intercom Outbound.
	 * Acceptance records the event only; Intercom controls audience, frequency and display.
	 * A job may call this directly; no job state or retry policy is recorded here.
	 */
	async send(userId: string, eventName: string, metadata: IntercomEventMetadata = {}): Promise<void> {
		if (!/^[a-z][a-z0-9_-]{0,99}$/.test(eventName)) throw new Error('Provide a valid Intercom event name.');
		if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).length > 20 || Object.entries(metadata).some(([key, value]) => !/^[a-zA-Z0-9_-]{1,100}$/.test(key) || !(typeof value === 'string' && value.length <= 255 || typeof value === 'number' && Number.isFinite(value)))) throw new Error('Intercom event data supports up to twenty text or numeric fields.');
		const signal = AbortSignal.timeout(this.#options.timeoutMs ?? 10000);
		await this.#resolveContact(userId, signal);
		const response = await this.#request('/events', { event_name: eventName, user_id: userId, created_at: Math.floor(Date.now() / 1000), metadata }, signal);
		if (!response.ok) throw new IntercomDeliveryError('event submission', response.status);
	}

	/** Sends a direct Messenger message once; requires an Intercom teammate sender ID. */
	async sendMessage(userId: string, message: IntercomMessage): Promise<{ id: string }> {
		if (!this.#options.adminId) throw new Error('Direct Intercom messages require an admin ID.');
		const body = renderMessage(message);
		const signal = AbortSignal.timeout(this.#options.timeoutMs ?? 10000);
		const contact = await this.#resolveContact(userId, signal);
		const response = await this.#request('/messages', {
			message_type: 'inapp', from: { type: 'admin', id: this.#options.adminId },
			to: { type: 'user', id: contact.id }, body,
			create_conversation_without_contact_reply: false,
		}, signal);
		if (!response.ok) throw new IntercomDeliveryError('message submission', response.status);
		const accepted = await response.json() as { id?: unknown };
		if (typeof accepted.id !== 'string' || !accepted.id) throw new Error('Intercom returned no message acceptance ID.');
		return { id: accepted.id };
	}

	/** Finds one canonical application identity, creating a user contact only when absent. */
	async #resolveContact(userId: string, signal: AbortSignal): Promise<{ id: string }> {
		if (!this.#options.accessToken) throw new Error('Intercom notification delivery requires an access token.');
		if (!userId) throw new Error('Intercom requires a persisted recipient.');
		let contact = await this.#findContact(userId, signal);
		if (!contact) {
			const response = await this.#request('/contacts', { role: 'user', external_id: userId }, signal);
			if (response.status === 409) contact = await this.#findContact(userId, signal);
			else {
				if (!response.ok) throw new IntercomDeliveryError('contact creation', response.status);
				contact = await response.json() as { id?: string; role?: string };
			}
		}
		if (!contact || typeof contact.id !== 'string' || !contact.id || contact.role !== 'user') throw new Error('Intercom contact resolution did not produce a user.');
		return { id: contact.id };
	}

	/** Uses an exact external identity match; email addresses never select the recipient. */
	async #findContact(userId: string, signal: AbortSignal): Promise<{ id?: string; role?: string } | null> {
		const response = await this.#request('/contacts/search', { query: { field: 'external_id', operator: '=', value: userId } }, signal);
		if (!response.ok) throw new IntercomDeliveryError('contact lookup', response.status);
		const result = await response.json() as { data?: { id?: string; role?: string }[] };
		if (!Array.isArray(result.data) || result.data.length > 1) throw new Error('Intercom contact lookup returned an invalid or ambiguous identity.');
		return result.data[0] ?? null;
	}

	/** Calls a fixed API origin, rejects redirects and shares the total delivery deadline. */
	#request(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
		return fetch(`https://api.intercom.io${path}`, {
			method: 'POST', signal, redirect: 'error',
			headers: { Authorization: `Bearer ${this.#options.accessToken}`, 'Content-Type': 'application/json', 'Intercom-Version': '2.14' },
			body: JSON.stringify(body),
		});
	}
}

/** Escapes plain-text content and validates the optional action link. */
function renderMessage(message: IntercomMessage): string {
	if (!message || typeof message.title !== 'string' || !message.title.trim() || typeof message.body !== 'string' || !message.body.trim()) throw new Error('Intercom requires a title and non-empty plain body.');
	let action = '';
	if (message.action) {
		const url = new URL(message.action.href);
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !message.action.label.trim()) throw new Error('Intercom actions require an HTTP(S) destination and a label.');
		action = `<p><a href="${escapeHtml(url.href)}">${escapeHtml(message.action.label)}</a></p>`;
	}
	return `<p><strong>${escapeHtml(message.title)}</strong></p><p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>${action}`;
}

/** Encodes dynamic text for HTML text and quoted attribute contexts. */
function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
