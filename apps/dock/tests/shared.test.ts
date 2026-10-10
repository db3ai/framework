import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../shared/ansi.js';
import { consoleArgs } from '../shared/consoleArgs.js';
import { detectPort } from '../shared/detectPort.js';
import { processKind } from '../shared/processKind.js';
import { displayCommand, workerArgs, workerLabel, workerProcessName } from '../shared/workerArgs.js';

describe('processKind', () => {
	it('classifies conventional db3 script names', () => {
		expect(processKind('api')).toBe('api');
		expect(processKind('dev')).toBe('web');
		expect(processKind('web')).toBe('web');
		expect(processKind('queue')).toBe('queue');
		expect(processKind('queue:emails')).toBe('queue');
		expect(processKind('scheduler')).toBe('scheduler');
		expect(processKind('db:migrate')).toBe('script');
	});

	it('falls back to the script body', () => {
		expect(processKind('jobs-runner', 'tsx server/queue.ts queue:work')).toBe('queue');
		expect(processKind('frontend2', 'vite --port 3000')).toBe('web');
		expect(processKind('cron2', 'tsx server/scheduler.ts')).toBe('scheduler');
	});
});

describe('workerArgs', () => {
	it('builds queue selections that match queue:work flags', () => {
		expect(workerArgs({ mode: 'queues', queues: ['emails', 'reports', 'emails'] })).toEqual(['queue:work', '--queues=emails,reports']);
		expect(workerArgs({ mode: 'queues', queues: [] })).toEqual(['queue:work', '--queue=default']);
		expect(workerArgs({ mode: 'all', exclude: ['articles'] })).toEqual(['queue:work', '--queues=*', '--exclude-queues=articles']);
		expect(workerArgs({ mode: 'all', exclude: [] })).toEqual(['queue:work', '--queues=*']);
		expect(workerArgs({ mode: 'pool', pool: 'general' })).toEqual(['queue:work', '--pool=general']);
	});

	it('adds tuning flags only when set', () => {
		expect(workerArgs({ mode: 'pool', pool: 'general' }, { interval: 500, maxJobs: 0, name: 'w1' }))
			.toEqual(['queue:work', '--pool=general', '--interval=500', '--name=w1']);
	});

	it('labels and names workers', () => {
		expect(workerLabel({ mode: 'all', exclude: ['a', 'b'] })).toBe('all except a, b');
		expect(workerProcessName('db3.ai', { mode: 'queues', queues: ['emails', 'reports'] })).toBe('db3-ai-queue-emails-reports');
	});

	it('quotes arguments for display', () => {
		expect(displayCommand('queue', ['queue:work', '--queues=*'])).toBe(`npm run queue -- queue:work '--queues=*'`);
		expect(displayCommand('dev', [])).toBe('npm run dev');
	});
});

describe('consoleArgs', () => {
	it('keeps the command when the script does not name it', () => {
		expect(consoleArgs('tsx server/queue.ts', ['queue:work', '--pool=general'])).toEqual(['queue:work', '--pool=general']);
	});

	it('drops the command when the script already runs it', () => {
		expect(consoleArgs('tsx server/queue.ts queue:work', ['queue:work', '--pool=general'])).toEqual(['--pool=general']);
	});
});

describe('detectPort', () => {
	it('finds ports announced by common dev servers', () => {
		expect(detectPort('  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m')).toBe(5173);
		expect(detectPort('Server listening at http://127.0.0.1:4000')).toBe(4000);
		expect(detectPort('api ready, listening on port 3001')).toBe(3001);
		expect(detectPort('processed 4000 jobs')).toBeNull();
	});
});

describe('stripAnsi', () => {
	it('removes colour, cursor and title sequences', () => {
		expect(stripAnsi('a\u001b[31mred\u001b[0m b')).toBe('ared b');
		expect(stripAnsi('\u001b[2J\u001b[H\u001b]0;title\u0007ready\r')).toBe('ready');
	});
});
