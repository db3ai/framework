import { STATUS_CODES } from 'node:http';

/** Minimal retained HTTP context, bounded independently of the original log sinks. */
interface PendingRequest {
	record: Record<string, unknown>;
	route: string;
	started: number;
	exchange?: Record<string, unknown>;
}

/** Groups redacted HTTP lifecycle records while preserving ordinary diagnostic logs. */
export class PrettyLogFormatter {
	readonly #requests = new Map<string, PendingRequest>();
	readonly #ended = new Set<string>();
	readonly #color: boolean;

	/** Creates a formatter; terminal capability is resolved by the console owner. */
	constructor(color = false) { this.#color = color; }

	/**
	 * Accepts one redacted Pino record and returns any completed output.
	 * Request context is bounded to 1,000 entries. Eviction is explicitly reported;
	 * later completions still print even when their earlier context is unavailable.
	 */
	format(record: Record<string, unknown>, now = Date.now()): string {
		const message = record.msg;
		const key = requestKey(record);
		const request = object(record.req);
		const exchange = object(record.httpExchange);
		const route = requestRoute(request);
		if (message === 'incoming request' && record.reqId != null && route) {
			this.#ended.delete(key);
			let evicted = '';
			if (this.#requests.size >= 1000) {
				const oldest = this.#requests.keys().next().value!;
				const pending = this.#requests.get(oldest)!;
				evicted = this.#http(pending.record, pending, 'tracking limit reached; response still pending');
				this.#requests.delete(oldest);
			}
			this.#requests.set(key, { record, route, started: now });
			return evicted;
		}
		if (message === 'request exchange' && exchange && Number(record.level ?? 30) <= 30) {
			if (record.reqId != null && this.#ended.has(key)) return '';
			const pending = this.#requests.get(key);
			if (pending) {
				pending.exchange = exchange;
				return '';
			}
			// A missing arrival (e.g. a filtered log level) must not lose the payload.
			return this.#http(record, { record, route: requestRoute(object(exchange.request)) || 'Request', started: now, exchange });
		}
		if (['request completed', 'request errored', 'request aborted', 'request timed out'].includes(String(message))) {
			if (record.reqId != null) {
				if (this.#ended.has(key)) return '';
				if (this.#ended.size >= 1000) this.#ended.delete(this.#ended.values().next().value!);
				this.#ended.add(key);
			}
			const pending = this.#requests.get(key);
			this.#requests.delete(key);
			const outcome = message === 'request completed' ? undefined : message === 'request errored' ? 'failed' : message === 'request aborted' ? 'cancelled' : 'timed out';
			return this.#http(record, pending ?? { record, route: route || 'Request', started: now }, outcome);
		}
		const severity = Number(record.level ?? 30);
		const category = severity >= 50 ? 'error' : severity >= 40 ? 'warn' : typeof record.component === 'string' ? record.component : severity <= 20 ? 'debug' : 'app';
		const context = Object.entries(record).filter(([key, value]) => !hiddenFields.has(key) && value != null).slice(0, 8).map(([key, value]) => `${compact(key, 40)}=${compact(value, 100)}`).join('  ');
		const details = errorDetails(record.err ?? record.error);
		return `${this.#paint(timestamp(record.time), 90)} ${this.#paint(`[${compact(category, 30)}]`, severity >= 50 ? 31 : severity >= 40 ? 33 : 36)} ${compact(record.msg ?? '', 500)}${context ? `  ${this.#paint(context, 90)}` : ''}\n${details ? indent(details) + '\n' : ''}`;
	}

	/** Returns waiting rows without mutating completed output or request order. */
	pending(now = Date.now()): string[] {
		return [...this.#requests.values()].map(request => {
			const elapsed = Math.max(0, now - request.started);
			return `[http] ${request.route}  ${elapsed >= 5000 ? 'slow · ' : ''}waiting · ${(elapsed / 1000).toFixed(1)} s  #${request.record.reqId}`;
		});
	}

	/** Finalizes requests whose transport ended before a completion record arrived. */
	finish(sourcePid?: number): string {
		let output = '';
		for (const [key, pending] of this.#requests) {
			if (sourcePid !== undefined && pending.record.pid !== sourcePid) continue;
			output += this.#http(pending.record, pending, 'interrupted · process stopped before response');
			this.#requests.delete(key);
		}
		return output;
	}

	/** Renders a single immutable HTTP block, including readable payload previews. */
	#http(record: Record<string, unknown>, pending: PendingRequest, outcome?: string): string {
		const status = object(record.res)?.statusCode ?? object(pending.exchange?.response)?.statusCode;
		const statusText = typeof status === 'number' ? `${status} ${STATUS_CODES[status] ?? ''}`.trim() : '';
		const elapsed = typeof record.responseTime === 'number' && Number.isFinite(record.responseTime) ? ` · ${Math.round(record.responseTime)} ms` : '';
		const tone = outcome || Number(status) >= 500 ? 31 : Number(status) >= 400 ? 33 : 32;
		const reference = record.reqId == null ? '' : `  #${compact(record.reqId, 60)}`;
		const bodies = bodyPreview(object(object(pending.exchange?.request)?.body), '> request') + bodyPreview(object(object(pending.exchange?.response)?.body), '< response');
		const details = errorDetails(record.err ?? record.error);
		return `${this.#paint(timestamp(pending.record.time), 90)} ${this.#paint('[http]', 36)} ${compact(pending.route, 240)}  ${this.#paint(outcome ?? (statusText || 'response'), tone)}${elapsed}${this.#paint(reference, 90)}\n${bodies}${details ? indent(details) + '\n' : ''}\n`;
	}

	/** Colours structural labels only, never application-controlled terminal escapes. */
	#paint(text: string, code: number): string { return this.#color ? `\u001b[${code}m${text}\u001b[0m` : text; }
}

const hiddenFields = new Set(['level', 'time', 'pid', 'hostname', 'source', 'environment', 'release', 'component', 'msg', 'req', 'res', 'httpExchange', 'responseTime', 'err', 'error']);

/** Separates processes and sources that independently allocate Fastify request IDs. */
function requestKey(record: Record<string, unknown>): string { return JSON.stringify([record.pid, record.source, record.reqId]); }

/** Narrows optional parsed context without trusting arbitrary application values. */
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

/** Extracts the method and URL without headers or payload duplication. */
function requestRoute(request: Record<string, unknown> | undefined): string { return typeof request?.method === 'string' && typeof request.url === 'string' ? `${request.method} → ${request.url}` : ''; }

/** Formats local wall time with a stable fallback for non-Pino input. */
function timestamp(value: unknown): string {
	const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : NaN);
	return Number.isNaN(date.getTime()) ? '--:--:--' : [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':');
}

/** Prevents control injection and bounds single-line summaries. */
function compact(value: unknown, limit: number): string {
	const text = clean(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)).replace(/\s+/g, ' ');
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Strips terminal controls while retaining readable line breaks. */
function clean(text: string): string { return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ''); }

/** Indents diagnostic text consistently beneath its owning request or message. */
function indent(text: string): string { return text.split('\n').map(line => `    ${line}`).join('\n'); }

/** Shows small JSON inline and larger JSON as a bounded, explicitly shortened preview. */
function bodyPreview(body: Record<string, unknown> | undefined, label: string): string {
	if (!body || body.kind === 'empty') return '';
	let text: string;
	if (body.value === undefined) text = String(body.note ?? `${body.kind} body omitted`);
	else if (body.kind === 'json' && !body.truncated) {
		const expanded = JSON.stringify(body.value, null, 2);
		const inline = expanded.replace(/\n\s*/g, ' ');
		text = inline.length <= 90 ? inline : expanded;
	} else text = String(body.value);
	const lines = clean(text).split('\n');
	const visible = lines.slice(0, 20).map(line => line.length > 160 ? `${line.slice(0, 159)}… [line shortened]` : line);
	if (lines.length > 20) visible.push(`… ${lines.length - 20} more lines (full captured body in JSON logs/devtools)`);
	if (body.truncated) visible.push(`… capture truncated (${body.sizeBytes ?? 'unknown'} bytes before limit)`);
	return `  ${label}\n${indent(visible.join('\n'))}\n`;
}

/** Preserves bounded error stacks and nested causes without terminal control sequences. */
function errorDetails(value: unknown, depth = 0): string {
	if (value == null || depth > 4) return '';
	const error = object(value);
	if (!error) return compact(value, 2000);
	const stack = typeof error.stack === 'string' ? clean(error.stack) : compact(`${error.type ?? 'Error'}: ${error.message ?? JSON.stringify(error)}`, 2000);
	const detail = stack.length > 16000 ? stack.slice(0, 16000) + '\n… stack shortened' : stack;
	const cause = errorDetails(error.cause, depth + 1);
	return `${detail}${cause ? `\nCaused by: ${cause}` : ''}`;
}
