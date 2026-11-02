import { createHash, timingSafeEqual } from 'node:crypto';
import { ActiveRecord } from '../../db';
import type { Scheduler } from '../../scheduler';
import { isFlowGraphDefinition, type FlowGraphDefinition, type FlowGraphTrigger, type FlowValue, type FlowValues } from '../contracts';
import type { Flows } from '../Flows';
import { validateFlowValues } from '../flowValueValidator';
import { resolveReferences } from '../graph/references';
import { FlowTriggerDelivery } from '../models';
import { renderFlowForm, renderFlowFormDone } from './flowForm';
import { FLOW_TRIGGER } from './triggerProblems';

const BEARER = /^Bearer\s+(\S+)$/i;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/;
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * A refused trigger request, with the HTTP status a route should answer with.
 * Messages are safe to show the sender.
 */
export class FlowTriggerError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
		this.name = 'FlowTriggerError';
	}
}

/** Settings and secrets triggers read, and the fetch used to check Turnstile. */
export interface FlowTriggerOptions {
	/** Defaults to `process.env`. */
	env?: () => Record<string, string | undefined>;
	/** Defaults to the global fetch. */
	fetch?: typeof fetch;
}

/** A form page ready to send, with the headers that let it be embedded. */
export interface FlowFormResponse {
	status: number;
	html: string;
	headers: Record<string, string>;
}

/**
 * Hosts the ways into version 2 flows that a flow file switches on in `triggers`:
 *
 * - `trigger.webhook`: `POST /_db3/flows/<flow>/<trigger>` with `Authorization: Bearer <token>`,
 *   where the token is the setting named by `config.token` (`{ "secret": "NAME" }`). The JSON body
 *   holds the flow inputs. An `Idempotency-Key` header makes retries return the first run.
 * - `trigger.form`: a hosted form at `/_db3/flows/<flow>/<trigger>/form` built from the flow
 *   inputs, embeddable in an iframe, with an optional Cloudflare Turnstile check.
 * - `trigger.schedule`: runs on the app scheduler: `every` minute, hour or day, optionally `at`
 *   a time, with fixed `input` values.
 *
 * Programmatic starts use `app().flows.start(name, input)` and need no trigger.
 */
export class FlowTriggers {
	constructor(private readonly flows: Flows, private readonly options: FlowTriggerOptions = {}) {}

	/**
	 * Starts a flow from a webhook delivery.
	 *
	 * @param flowName - Flow name or id from the URL.
	 * @param triggerName - Trigger name from the URL.
	 * @param request - Authorization and Idempotency-Key headers, and the parsed JSON body.
	 * @returns The run, and whether this delivery repeated an earlier one.
	 * @throws FlowTriggerError for bad credentials, inputs or keys.
	 */
	async webhook(flowName: string, triggerName: string, request: { authorization?: string; idempotencyKey?: string; body: unknown }): Promise<{ runId: string; duplicate: boolean }> {
		const { flow, trigger } = await this.#find(flowName, triggerName, FLOW_TRIGGER.webhook);
		const expected = this.#secret(trigger.config?.token);
		const given = BEARER.exec(request.authorization ?? '')?.[1];
		if (!expected || !given || !sameText(given, expected)) throw new FlowTriggerError(401, 'Webhook credentials are invalid or the webhook is unavailable.');
		if (request.idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(request.idempotencyKey)) throw new FlowTriggerError(400, 'Idempotency-Key must be 1 to 128 visible ASCII characters.');

		const input = this.#input(flow, request.body);
		if (request.idempotencyKey === undefined) return { runId: (await this.flows.start(flow.id, input)).id!, duplicate: false };

		const idempotencyHash = digest(`${flow.id}:${triggerName}:${request.idempotencyKey}`);
		const payloadHash = digest(canonicalJson(input));
		const db = FlowTriggerDelivery.getDb();
		try {
			// Transaction invariant: a delivery row exists exactly when its run does, so a retry
			// never finds a key without a run, nor a run that a retry would start again.
			return await db.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
				const previous = await FlowTriggerDelivery.where({ flowId: flow.id, trigger: triggerName, idempotencyHash }).first();
				if (previous) return this.#repeat(previous, payloadHash);
				const run = await this.flows.start(flow.id, input);
				await FlowTriggerDelivery.create({ flowId: flow.id, trigger: triggerName, idempotencyHash, payloadHash, run }).save();
				return { runId: run.id!, duplicate: false };
			}));
		} catch (error) {
			// Two deliveries with one key raced; the unique key let one win. Answer as its repeat.
			const winner = await FlowTriggerDelivery.where({ flowId: flow.id, trigger: triggerName, idempotencyHash }).first();
			if (winner) return this.#repeat(winner, payloadHash);
			throw error;
		}
	}

	/**
	 * Renders a hosted form.
	 *
	 * @param flowName - Flow name or id.
	 * @param triggerName - Trigger name.
	 * @param action - URL the form posts to.
	 * @returns HTML page and headers.
	 */
	async formPage(flowName: string, triggerName: string, action: string): Promise<FlowFormResponse> {
		const { flow, trigger } = await this.#find(flowName, triggerName, FLOW_TRIGGER.form);
		return { status: 200, html: renderFlowForm(flow, this.#formSettings(trigger), action), headers: this.#formHeaders(trigger) };
	}

	/**
	 * Starts a flow from a submitted hosted form.
	 *
	 * @param flowName - Flow name or id.
	 * @param triggerName - Trigger name.
	 * @param fields - Submitted fields.
	 * @param remoteIp - Sender address, passed to Turnstile.
	 * @param action - URL the form posts to, for showing it again with a message.
	 * @returns Thank-you page, or the form again with what to fix.
	 */
	async submitForm(flowName: string, triggerName: string, fields: Record<string, string>, remoteIp: string | undefined, action: string): Promise<FlowFormResponse> {
		const { flow, trigger } = await this.#find(flowName, triggerName, FLOW_TRIGGER.form);
		const settings = this.#formSettings(trigger);
		const headers = this.#formHeaders(trigger);
		const again = (message: string): FlowFormResponse => ({ status: 422, html: renderFlowForm(flow, settings, action, { message, values: fields }), headers });

		// Bots fill the hidden field; tell them it worked and start nothing.
		if (fields._website) return { status: 200, html: renderFlowFormDone(settings), headers };

		if (settings.turnstileSiteKey) {
			const secret = this.#secret(trigger.config?.turnstileSecret);
			if (!secret) throw new FlowTriggerError(503, 'This form is not set up yet.');
			if (!await this.#turnstile(secret, fields['cf-turnstile-response'], remoteIp)) return again('Please complete the check and send again.');
		}

		const input: FlowValues = {};
		for (const [name, definition] of Object.entries(flow.inputs)) {
			const raw = fields[name];
			if (definition.type === 'boolean') input[name] = raw === 'on' || raw === 'true';
			else if (raw === undefined || raw === '') continue;
			else if (definition.type === 'number') input[name] = Number(raw);
			else input[name] = raw;
		}
		try {
			validateFlowValues(input, flow.inputs, 'input');
		} catch (error) {
			return again(error instanceof Error ? friendlyInputError(error.message) : 'Check the form and send again.');
		}
		await this.flows.start(flow.id, input);
		return { status: 200, html: renderFlowFormDone(settings), headers };
	}

	/**
	 * Registers every schedule trigger in the app's flows with the scheduler.
	 * Call it once while the scheduler process starts.
	 *
	 * @param scheduler - The app scheduler.
	 * @returns Names of the scheduled triggers, as `flow/trigger`.
	 */
	async schedule(scheduler: Scheduler): Promise<string[]> {
		const found: { flow: FlowGraphDefinition; name: string; trigger: FlowGraphTrigger }[] = [];
		for (const summary of await this.flows.listDefinitions()) {
			if (summary.schemaVersion !== 2) continue;
			const stored = await this.flows.definition(summary.id);
			if (!isFlowGraphDefinition(stored.definition)) continue;
			for (const [name, trigger] of Object.entries(stored.definition.triggers ?? {})) {
				if (trigger.type === FLOW_TRIGGER.schedule) found.push({ flow: stored.definition, name, trigger });
			}
		}

		scheduler.register('flows', schedule => {
			for (const { flow, name, trigger } of found) {
				const input = (trigger.config?.input ?? {}) as FlowValues;
				const event = schedule.call(async () => { await this.flows.start(flow.id, input); }).name(`${flow.name}.${name}`);
				const every = trigger.config?.every;
				const at = trigger.config?.at;
				if (typeof trigger.config?.timezone === 'string') event.timezone(trigger.config.timezone);
				if (every === 'minute') event.everyMinute();
				else if (every === 'hour') event.hourly();
				else if (typeof at === 'string') event.dailyAt(at);
				else event.daily();
			}
		});
		return found.map(({ flow, name }) => `${flow.name}/${name}`);
	}

	async #find(flowName: string, triggerName: string, type: string): Promise<{ flow: FlowGraphDefinition; trigger: FlowGraphTrigger }> {
		let definition;
		try {
			definition = (await this.flows.definition(flowName)).definition;
		} catch {
			throw new FlowTriggerError(404, 'There is no such flow.');
		}
		const trigger = isFlowGraphDefinition(definition) ? definition.triggers?.[triggerName] : undefined;
		if (!isFlowGraphDefinition(definition) || !trigger || trigger.type !== type) throw new FlowTriggerError(404, 'There is no such trigger.');
		return { flow: definition, trigger };
	}

	#input(flow: FlowGraphDefinition, body: unknown): FlowValues {
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FlowTriggerError(400, 'Send a JSON object with the flow inputs.');
		const extra = Object.keys(body).filter(name => !Object.hasOwn(flow.inputs, name));
		if (extra.length) throw new FlowTriggerError(400, `This flow has no input ${extra.join(', ')}.`);
		try {
			return validateFlowValues(body as FlowValues, flow.inputs, 'input');
		} catch (error) {
			throw new FlowTriggerError(400, error instanceof Error ? error.message : 'The inputs are not valid.');
		}
	}

	#repeat(previous: FlowTriggerDelivery, payloadHash: string): { runId: string; duplicate: boolean } {
		if (previous.payloadHash !== payloadHash) throw new FlowTriggerError(409, 'This Idempotency-Key was already used with different inputs.');
		return { runId: String(typeof previous.run === 'object' ? previous.run?.id : previous.run), duplicate: true };
	}

	#env(): Record<string, string | undefined> {
		return this.options.env?.() ?? process.env;
	}

	/** Reads a `{ "secret": "NAME" }` setting; null when missing or unset. */
	#secret(value: FlowValue | undefined): string | null {
		if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.secret !== 'string') return null;
		return this.#env()[value.secret] || null;
	}

	#formSettings(trigger: FlowGraphTrigger) {
		const config = (trigger.config ?? {}) as FlowValues;
		const text = (key: string): string | undefined => {
			const value = config[key];
			if (value === undefined || value === null) return undefined;
			const resolved = resolveReferences(value, { input: {}, steps: {}, env: this.#env() });
			return typeof resolved === 'string' && resolved ? resolved : undefined;
		};
		return {
			title: text('title'),
			intro: text('intro'),
			submit: text('submit'),
			thanks: text('thanks'),
			fields: Array.isArray(config.fields) ? config.fields.map(String) : undefined,
			turnstileSiteKey: text('turnstileSiteKey'),
		};
	}

	#formHeaders(trigger: FlowGraphTrigger): Record<string, string> {
		const embed = trigger.config?.embedOn;
		const ancestors = Array.isArray(embed) && embed.length ? embed.map(String).join(' ') : '*';
		return {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
			'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; form-action 'self'; frame-ancestors ${ancestors}`,
			'referrer-policy': 'strict-origin-when-cross-origin',
		};
	}

	async #turnstile(secret: string, response: string | undefined, remoteIp: string | undefined): Promise<boolean> {
		if (!response) return false;
		const body = new URLSearchParams({ secret, response, ...(remoteIp ? { remoteip: remoteIp } : {}) });
		try {
			const answer = await (this.options.fetch ?? fetch)(TURNSTILE_VERIFY, { method: 'POST', body });
			const result = await answer.json() as { success?: boolean };
			return result.success === true;
		} catch {
			return false;
		}
	}
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sameText(a: string, b: string): boolean {
	const left = Buffer.from(digest(a));
	const right = Buffer.from(digest(b));
	return timingSafeEqual(left, right);
}

/** Stable JSON for comparing payloads; nesting is bounded. */
function canonicalJson(value: FlowValue, depth = 0): string {
	if (depth > 32) throw new FlowTriggerError(400, 'JSON inputs may be nested at most 32 levels.');
	if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`;
	return JSON.stringify(value);
}

/** Turns a validator message such as `input.email is required` into words for a form. */
function friendlyInputError(message: string): string {
	return message.replace(/\binput\./g, '').replace(/^./, first => first.toUpperCase());
}
