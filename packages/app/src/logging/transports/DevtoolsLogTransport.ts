import { randomUUID } from 'node:crypto';
import build from 'pino-abstract-transport';
import type { Transform } from 'node:stream';

import type * as logging from '../contracts/index.js';

interface PinoLogRecord extends Record<string, unknown> {
	level?: unknown;
	msg?: unknown;
	source?: unknown;
	time?: unknown;
}

/**
 * Log event accepted by the Platform development event service.
 */
export interface DevtoolsLogEvent extends Record<string, unknown> {
	type: 'log';
	id: string;
	source: string;
	timestamp: string;
	level: Exclude<logging.LogLevel, 'silent'>;
	numericLevel: number;
	message: string;
}

const levelLabels = new Map<number, DevtoolsLogEvent['level']>([
	[10, 'trace'],
	[20, 'debug'],
	[30, 'info'],
	[40, 'warn'],
	[50, 'error'],
	[60, 'fatal'],
]);

/**
 * Creates the worker-thread transport that streams Pino records to devtools.
 *
 * @param options - Structured-clone-safe HTTP transport configuration.
 * @returns Writable Pino transport stream.
 */
export default async function createDevtoolsLogTransport(
	options: logging.DevtoolsLogOptions = {},
): Promise<Transform> {
	const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
	const dispatcherModule = await import(
		`../../devtools/HttpEventDispatcher.${extension}`
	) as typeof import('../../devtools/HttpEventDispatcher');
	const { createHttpEventDispatcher } = dispatcherModule;
	const dispatch = createHttpEventDispatcher<DevtoolsLogEvent>(options);

	return build(async (source) => {
		for await (const input of source) {
			if (!isRecord(input)) continue;

			dispatch(pinoRecordToDevtoolsEvent(input));
		}
	}, {
		close: async () => {
			await dispatch.close();
		},
	});
}

/**
 * Converts one Pino JSON object into the shared development event envelope.
 *
 * @param record - Structured record parsed by the Pino transport.
 * @returns Normalized log event for storage and live streaming.
 */
export function pinoRecordToDevtoolsEvent(
	record: PinoLogRecord,
): DevtoolsLogEvent {
	const numericLevel = numericValue(record.level, 30);
	const {
		level: _level,
		msg: _message,
		source: _source,
		time: _time,
		...context
	} = record;

	return {
		...context,
		type: 'log',
		id: randomUUID(),
		source: stringValue(record.source, 'app'),
		timestamp: timestampValue(record.time),
		level: levelLabels.get(numericLevel) ?? 'info',
		numericLevel,
		message: stringValue(record.msg, ''),
	};
}

/**
 * Checks whether an unknown transport value is an object record.
 *
 * @param input - Parsed transport value.
 * @returns True when the value can be normalized as a log record.
 */
function isRecord(input: unknown): input is PinoLogRecord {
	return Boolean(input) && typeof input === 'object' && !Array.isArray(input);
}

/**
 * Returns a finite number or a fallback.
 *
 * @param input - Candidate numeric field.
 * @param fallback - Value used when conversion fails.
 * @returns Finite numeric value.
 */
function numericValue(input: unknown, fallback: number): number {
	const value = Number(input);

	return Number.isFinite(value) ? value : fallback;
}

/**
 * Returns a non-empty string or a fallback.
 *
 * @param input - Candidate string field.
 * @param fallback - Value used when the field is empty.
 * @returns Normalized string.
 */
function stringValue(input: unknown, fallback: string): string {
	return typeof input === 'string' && input.trim() ? input : fallback;
}

/**
 * Converts a Pino epoch timestamp into the panel's ISO representation.
 *
 * @param input - Pino time field.
 * @returns Valid ISO timestamp.
 */
function timestampValue(input: unknown): string {
	const milliseconds = numericValue(input, Date.now());
	const date = new Date(milliseconds);

	return Number.isNaN(date.getTime())
		? new Date().toISOString()
		: date.toISOString();
}
