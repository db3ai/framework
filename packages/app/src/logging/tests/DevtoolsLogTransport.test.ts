import {
	describe,
	expect,
	it,
} from 'vitest';

import { pinoRecordToDevtoolsEvent } from '../transports/DevtoolsLogTransport';

describe('DevtoolsLogTransport', () => {
	it('normalizes Pino records into log events without losing context', () => {
		const event = pinoRecordToDevtoolsEvent({
			level: 50,
			time: Date.parse('2026-07-24T10:30:00.000Z'),
			msg: 'Job failed',
			source: 'app-worker',
			component: 'queue-worker',
			jobId: 'job-1',
		});

		expect(event).toMatchObject({
			type: 'log',
			source: 'app-worker',
			timestamp: '2026-07-24T10:30:00.000Z',
			level: 'error',
			numericLevel: 50,
			message: 'Job failed',
			component: 'queue-worker',
			jobId: 'job-1',
		});
		expect(event.id).toEqual(expect.any(String));
	});

	it('uses safe fallbacks for malformed transport fields', () => {
		expect(pinoRecordToDevtoolsEvent({
			level: 'not-a-number',
			time: 'not-a-time',
		})).toMatchObject({
			source: 'app',
			level: 'info',
			numericLevel: 30,
			message: '',
		});
	});
});
