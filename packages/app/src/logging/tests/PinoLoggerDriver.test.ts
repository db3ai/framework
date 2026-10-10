import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { LoggingOptions } from '@db3.ai/app/logging';

const execute = promisify(execFile);

/** Runs the public logger and a real Fastify request in an isolated process. */
async function run(options: LoggingOptions & { tty?: boolean }, environment: Record<string, string> = {}) {
	const env = { ...process.env };
	for (const key of ['PLATFORM_LOG_FORMAT', 'PLATFORM_LOG_FILE', 'PLATFORM_LOG_LEVEL', 'PLATFORM_LOG_DEVTOOLS', 'NO_COLOR', 'FORCE_COLOR']) delete env[key];
	return execute(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/prettyLogs.mjs', import.meta.url)), JSON.stringify(options)], { env: { ...env, TERM: 'xterm-256color', ...environment }, timeout: 15000 });
}

describe('pretty console transport', () => {
	it('defaults development terminals to concise output and keeps complete redacted JSON in files', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'db3-pretty-'));
		try {
			const file = join(directory, 'events.jsonl');
			const { stdout, stderr } = await run({ environment: 'development', tty: true, file }, { NO_COLOR: '1' });
			expect(stderr).toBe('');
			expect(stdout).toContain('[app]');
			expect(stdout).toMatch(/POST → \/hello  200 OK · \d+ ms/);
			expect(stdout).toContain('Error: Provider unavailable');
			expect(stdout).not.toMatch(/incoming request|request exchange|request completed|synthetic-secret|synthetic-body-secret|\u001b\[3[0-9]m/);
			const records = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
			expect(records.map(record => record.msg)).toEqual(['Worker ready', 'incoming request', 'request exchange', 'request completed', 'Job failed']);
			expect(records[0].password).toBeUndefined();
			expect(records[2].httpExchange.request.body.value).toEqual({ user: 1234, password: '[Redacted]' });
			expect(stdout).toContain('> request');
			expect(stdout).toContain('< response');
			expect(stdout).toContain('1234');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it.each([{ environment: 'production', tty: true }, { environment: 'development', tty: false }, { environment: 'test', tty: true }])('preserves JSON by default for $environment with tty=$tty', async options => {
		const { stdout } = await run(options);
		expect(stdout.trim().split('\n').map(line => JSON.parse(line))).toHaveLength(options.environment === 'development' ? 5 : 4);
	});

	it('supports format overrides and gives explicit options precedence', async () => {
		const pretty = await run({ environment: 'development', tty: false }, { PLATFORM_LOG_FORMAT: 'pretty' });
		expect(pretty.stdout).toMatch(/POST → \/hello  200/);
		expect(pretty.stdout).not.toContain('\u001b');
		const json = await run({ environment: 'development', tty: true, consoleFormat: 'json' }, { PLATFORM_LOG_FORMAT: 'pretty' });
		expect(JSON.parse(json.stdout.split('\n')[0]!).msg).toBe('Worker ready');
	});

	it('colours piped pretty output when FORCE_COLOR asks, unless NO_COLOR is set', async () => {
		const forced = await run({ environment: 'development', tty: false }, { PLATFORM_LOG_FORMAT: 'pretty', FORCE_COLOR: '1' });
		expect(forced.stdout).toMatch(/POST → \/hello/);
		expect(forced.stdout).toMatch(/\u001b\[3[0-9]m/);
		const off = await run({ environment: 'development', tty: false }, { PLATFORM_LOG_FORMAT: 'pretty', FORCE_COLOR: '1', NO_COLOR: '1' });
		expect(off.stdout).not.toContain('\u001b');
		const zero = await run({ environment: 'development', tty: true }, { FORCE_COLOR: '0' });
		// A TTY still gets cursor redraws; only colour codes must be absent.
		expect(zero.stdout).not.toMatch(/\u001b\[3[0-9]m/);
	});

	it('disables console output and rejects invalid format configuration', async () => {
		expect((await run({ console: false })).stdout).toBe('');
		await expect(run({}, { PLATFORM_LOG_FORMAT: 'invalid' })).rejects.toThrow('Invalid PLATFORM_LOG_FORMAT');
	});
});
