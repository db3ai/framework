import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { App, app } from '@db3.ai/app/server';
import { Cli, defineCommand, type CliCommand } from '@db3.ai/app/cli';

/** Real application subclass that records lifecycle ownership without replacing services. */
class CommandApp extends App {
	closed = 0;
	/** Closes the actual framework resources and records the invocation cleanup. */
	override async close(): Promise<void> { this.closed++; await super.close(); }
}

/** Creates isolated output adapters for a command runner. */
function output() {
	const messages: string[] = [];
	const errors: string[] = [];
	return { messages, errors, write: (value: string) => { messages.push(value); }, writeError: (value: string) => { errors.push(value); } };
}

describe('service command runner', () => {
	/** Action handlers receive named parameters and a live app before doing any work. */
	it('maps named action parameters and formats results independently of service execution', async () => {
		const io = output();
		let instance: CommandApp | undefined;
		const command = defineCommand({
			name: 'example:action', description: 'Return a domain result.',
			parameters: [{ name: 'name', required: true }, { name: 'suffix' }],
			/** Executes inside the established application context without requesting it manually. */
			handle(parameters) { expect(app()).toBe(instance); return { name: parameters.name, suffix: parameters.suffix ?? 'default', valid: false }; },
			exitCode: result => result.valid ? 0 : 2,
		});
		const runner = new Cli({ createApp: () => { instance = new CommandApp(); return instance; }, commands: [command] }, io);
		expect(await runner.run(['example:action', 'Ada'])).toBe(2);
		expect(JSON.parse(io.messages[0]!)).toEqual({ name: 'Ada', suffix: 'default', valid: false });
		expect(instance?.closed).toBe(1);
		expect(io.errors).toEqual([]);
	});

	/** Help and invalid input must never open an app or execute a command. */
	it('renders registered help and rejects bad arguments before bootstrap', async () => {
		let created = 0;
		let executed = 0;
		const io = output();
		const runner = new Cli({ createApp: () => { created++; return new CommandApp(); }, commands: [{ name: 'example:run', description: 'Run an example.', arguments: [{ name: 'name', required: true }], run: () => { executed++; } }] }, io);
		expect(await runner.run(['--help'])).toBe(0);
		expect(await runner.run(['example:run', '--help'])).toBe(0);
		expect(io.messages.join('\n')).toContain('db3 example:run <name>');
		for (const args of [['missing'], ['example:run'], ['example:run', 'one', 'two'], ['example:run', '--force']]) expect(await runner.run(args)).toBe(1);
		expect(created).toBe(0);
		expect(executed).toBe(0);
	});

	/** All app requests in one invocation share the same instance and close it afterwards. */
	it.each([false, true])('closes its real application after success or failure: %s', async fail => {
		const io = output();
		const instances: CommandApp[] = [];
		const command: CliCommand = {
			name: 'example:run', description: 'Exercise app ownership.',
			/** Uses the real application context before optionally failing. */
			async run(context) {
				const [first, second] = await Promise.all([context.app(), context.app()]);
				expect(first).toBe(second);
				expect(app()).toBe(first);
				if (fail) throw new Error('Operation failed.');
			},
		};
		const runner = new Cli({ commands: [command], createApp: () => { const instance = new CommandApp(); instances.push(instance); return instance; } }, io);
		expect(await runner.run(['example:run'])).toBe(fail ? 1 : 0);
		expect(instances).toHaveLength(1);
		expect(instances[0]!.closed).toBe(1);
		expect(() => app()).toThrow();
		expect(io.errors).toEqual(fail ? ['Operation failed.'] : []);
		expect(await runner.run(['example:run'])).toBe(fail ? 1 : 0);
		expect(instances).toHaveLength(2);
		expect(instances[1]!.closed).toBe(1);
	});

	/** A command may report failure without throwing; bootstrap failures remain actionable. */
	it('preserves nonzero statuses and handles missing or failed bootstrap', async () => {
		const io = output();
		const command: CliCommand = { name: 'example:run', description: 'Needs an app.', run: async context => { await context.app(); return 2; } };
		expect(await new Cli({ commands: [command], createApp: () => new CommandApp() }, io).run(['example:run'])).toBe(2);
		expect(await new Cli({ commands: [command] }, io).run(['example:run'])).toBe(1);
		expect(await new Cli({ commands: [command], createApp: () => { throw new Error('Missing configuration.'); } }, io).run(['example:run'])).toBe(1);
		expect(io.errors).toEqual(['This command requires createApp in server/cli.config.ts.', 'Missing configuration.']);
	});

	/** Shutdown failures affect the exit status after framework resources are released. */
	it('reports cleanup failure after releasing the application context', async () => {
		/** App whose own extra resource reports a shutdown failure. */
		class ShutdownFailureApp extends CommandApp {
			/** Releases framework resources before reporting the app-owned failure. */
			override async close(): Promise<void> { await super.close(); throw new Error('Could not close extra resource.'); }
		}
		const io = output();
		const instance = new ShutdownFailureApp();
		const runner = new Cli({ createApp: () => instance, commands: [{ name: 'example:run', description: 'Needs app.', run: async context => { await context.app(); } }] }, io);
		expect(await runner.run(['example:run'])).toBe(1);
		expect(instance.closed).toBe(1);
		expect(() => app()).toThrow();
		expect(io.errors).toEqual(['Application shutdown failed: Could not close extra resource.']);
	});

	/** Registration must not silently override an existing service or accept ambiguous usage. */
	it('rejects duplicate commands and invalid argument declarations', () => {
		const command: CliCommand = { name: 'example:run', description: 'Example.', run: () => {} };
		expect(() => new Cli({ commands: [command, command] })).toThrow('Duplicate');
		expect(() => new Cli({ commands: [{ ...command, arguments: [{ name: 'optional' }, { name: 'required', required: true }] }] })).toThrow('Invalid argument');
	});
});

describe('db3 executable', () => {
	/** Loads real TypeScript registration and extensionless imports through the shipped binary. */
	it('loads service registration, prints help without bootstrap, and creates jobs from source', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'db3-cli-'));
		try {
			await mkdir(join(directory, 'server'));
			await writeFile(join(directory, 'package.json'), '{"type":"module"}');
			await writeFile(join(directory, 'server/message.ts'), 'export const message: string = "Custom service ran";');
			await writeFile(join(directory, 'server/cli.config.ts'), `import { message } from './message';
export default { createApp() { throw new Error('Help must not boot'); }, commands: [{ name: 'example:run', description: 'Custom service.', run({ write }) { write(message); } }] };`);
			const help = execute(directory, '--help');
			expect(help.status, help.stderr).toBe(0);
			expect(help.stdout).toContain('example:run');
			expect(help.stdout).toContain('db3 repl');
			expect(execute(directory, 'repl', '--help').status).toBe(0);
			expect(execute(directory, 'example:run').stdout).toContain('Custom service ran');
			const job = execute(directory, 'queue:make-job', 'ExampleJob');
			expect(job.status, job.stderr).toBe(0);
			expect(await readFile(join(directory, 'server/jobs/ExampleJob.ts'), 'utf8')).toContain('class ExampleJob');
			expect(execute(directory, 'queue:make-job', 'ExampleJob').status).toBe(1);
			await writeFile(join(directory, 'server/cli.config.ts'), 'export default undefined;');
			expect(execute(directory, '--help').status).toBe(1);
			await rm(join(directory, 'server/cli.config.ts'));
			expect(execute(directory, '--help').status).toBe(0);
		} finally { await rm(directory, { recursive: true, force: true }); }
	}, 30_000);
});

/** Runs the real package binary without shell parsing or inherited app settings. */
function execute(directory: string, ...args: string[]) {
	return spawnSync(process.execPath, [fileURLToPath(new URL('../../../bin/db3.mjs', import.meta.url)), ...args], { cwd: directory, encoding: 'utf8', timeout: 15_000, env: { ...process.env, DATABASE_URL: '', OPENAI_API_KEY: '' } });
}
