import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
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
			expect(help.stdout).toContain('aliases: queue');
			expect(execute(directory, 'queue', '--help').stdout).toContain('--pool=<string>');
			expect(execute(directory, 'scheduler', '--help').stdout).toContain('db3 scheduler');
			const catalogue = JSON.parse(execute(directory, 'list', '--json').stdout);
			expect(catalogue.formatVersion).toBe(1);
			expect(catalogue.commands.find((item: { name: string }) => item.name === 'queue:work')).toMatchObject({ aliases: ['queue'], execution: 'worker' });
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


describe('declared options and aliases', () => {
	/** Options are converted once, while literal positional and repeatable string values survive intact. */
	it('uses the same command for aliases, typed options, defaults and the end-of-options marker', async () => {
		const io = output();
		const runner = new Cli({ commands: [defineCommand({ name: 'lead_tools:refresh', aliases: ['refresh'], description: 'Refresh.', needsApp: false,
			parameters: [{ name: 'value', required: true }], options: [
				{ name: 'verbose', type: 'boolean', default: false, description: 'Verbose.' },
				{ name: 'count', type: 'number', integer: true, min: 1, max: 5, default: 2, description: 'Count.' },
				{ name: 'tag', type: 'string', multiple: true, description: 'Tags.' },
				{ name: 'name', type: 'string', required: true, description: 'Name.' },
			],
			/** Returns the parser's actual values without creating app resources. */
			handle(parameters, context) { return { parameters, options: context.options }; },
		})] }, io);
		expect(await runner.run(['refresh', '--name', 'a=b=c', '--tag=first', '--tag', 'second', '--verbose=false', '--', '--literal'])).toBe(0);
		expect(JSON.parse(io.messages[0]!)).toEqual({ parameters: { value: '--literal' }, options: { name: 'a=b=c', tag: ['first', 'second'], verbose: false, count: 2 } });
		expect(await runner.run(['refresh', '--help'])).toBe(0);
		expect(io.messages[1]).toContain('db3 refresh <value> [options]');
		expect(io.messages[1]).toContain('--count=<number>');
		const metadata = runner.commands()[0]!;
		(metadata.options[2] as { description: string }).description = 'changed';
		expect(runner.commands()[0]!.options[2]!.description).toBe('Tags.');
	});

	/** All failures occur before the real application factory is called. */
	it.each([
		['--count'], ['--count='], ['--count=no'], ['--count=0'], ['--count=1.5'], ['--count=6'],
		['--unknown'], ['--enabled=no'], ['--count=2', '--count=3'], ['extra'],
	])('rejects invalid input before startup: %j', async (...values) => {
		let created = 0;
		const io = output();
		const runner = new Cli({ createApp: () => { created++; return new CommandApp(); }, commands: [defineCommand({ name: 'example:options', description: 'Options.', options: [
			{ name: 'count', type: 'number', integer: true, min: 1, max: 5, description: 'Count.' },
			{ name: 'enabled', type: 'boolean', description: 'Enabled.' },
		], handle: () => 'should not execute' })] }, io);
		expect(await runner.run(['example:options', ...values])).toBe(1);
		expect(created).toBe(0);
		expect(io.errors[0]).toContain('Usage: db3 example:options');
	});

	/** Alias collisions and malformed option defaults cannot change a previously registered operation. */
	it('rejects alias collisions and invalid option declarations', () => {
		const command: CliCommand = { name: 'example:run', aliases: ['example'], description: 'Example.', run() {} };
		expect(() => new Cli({ commands: [command, { ...command, name: 'example' }] })).toThrow('Duplicate');
		expect(() => new Cli({ commands: [{ ...command, name: undefined } as unknown as CliCommand] })).toThrow('Invalid CLI');
		expect(() => new Cli({ commands: [{ ...command, options: [{ name: undefined, type: 'boolean', description: 'Missing name.' }] } as unknown as CliCommand] })).toThrow('Invalid option');
		expect(() => new Cli({ commands: [{ ...command, options: [{ name: 'count', type: 'number', default: 0, min: 1, description: 'Count.' }] }] })).toThrow('numeric');
		expect(() => new Cli({ commands: [{ ...command, options: [{ name: 'help', type: 'boolean', description: 'Reserved.' }] }] })).toThrow('Invalid option');
	});

	/** Operational preparation is shared by concurrent requests, but remains optional for ordinary commands. */
	it.each([false, true])('prepares once and closes the real app after preparation success/failure: %s', async fail => {
		const io = output();
		let prepared = 0;
		const instance = new CommandApp();
		const runner = new Cli({ createApp: () => instance, prepareApp: () => { prepared++; if (fail) throw new Error('Preparation failed.'); }, commands: [{ name: 'example:prepare', description: 'Prepare.',
			/** Requests preparation concurrently to exercise the one-owner promise. */
			async run(context) { const apps = await Promise.all([context.prepareApp(), context.prepareApp()]); expect(apps[0]).toBe(apps[1]); },
		}] }, io);
		expect(await runner.run(['example:prepare'])).toBe(fail ? 1 : 0);
		expect(prepared).toBe(1);
		expect(instance.closed).toBe(1);
	});

	/** Cancellation starts draining and app cleanup only runs after the action has finished it. */
	it('keeps a cancelled worker alive until its owned work drains and removes signal listeners', async () => {
		const io = output();
		const controller = new AbortController();
		const instance = new CommandApp();
		const started = Promise.withResolvers<void>();
		const draining = Promise.withResolvers<void>();
		const drained = Promise.withResolvers<void>();
		const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
		const runner = new Cli({ createApp: () => instance, commands: [{ name: 'example:work', aliases: ['example'], execution: 'worker', description: 'Worker.',
			/** Waits for cancellation, then deliberately retains the app through a drain barrier. */
			async run(context) {
				await context.app();
				const stopped = Promise.withResolvers<void>();
				context.signal.addEventListener('abort', () => stopped.resolve(), { once: true });
				started.resolve();
				await stopped.promise;
				draining.resolve();
				await drained.promise;
			},
		}] }, { ...io, signal: controller.signal });
		const invocation = runner.run(['example']);
		try {
			await started.promise;
			controller.abort();
			await draining.promise;
			expect(instance.closed).toBe(0);
		} finally { drained.resolve(); await invocation; }
		expect(instance.closed).toBe(1);
		expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
	});
});


/** The shipped executable must drain cooperatively on real OS signals rather than close its app early. */
it.each(['SIGINT', 'SIGTERM'] as const)('awaits worker drain and application cleanup on %s', async signal => {
	const directory = await mkdtemp(join(tmpdir(), 'db3-cli-signal-'));
	let child: ReturnType<typeof spawn> | undefined;
	let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await mkdir(join(directory, 'server'));
		await writeFile(join(directory, 'package.json'), '{"type":"module"}');
		const appModule = fileURLToPath(new URL('../../server/index.ts', import.meta.url));
		await writeFile(join(directory, 'server/cli.config.ts'), `import { App } from ${JSON.stringify(appModule)};
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
/** Records cleanup only after action-owned drain has completed. */
class WorkerApp extends App {
	/** Requires the drain marker before releasing the actual framework runtime. */
	async close() { await readFile('drained'); await super.close(); await writeFile('closed', 'closed'); }
}
export default { createApp: () => new WorkerApp(), commands: [{ name: 'test:worker', aliases: ['worker'], description: 'Worker.', execution: 'worker',
	/** Waits for a real CLI signal, then completes bounded in-flight work before returning. */
	async run(context) {
		await context.app();
		const stopped = new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }));
		context.write('worker-ready');
		await stopped;
		await setTimeout(30);
		await writeFile('drained', 'drained');
	}
}] };`);
		const binary = fileURLToPath(new URL('../../../bin/db3.mjs', import.meta.url));
		child = spawn(process.execPath, [binary, 'worker'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const ready = Promise.withResolvers<void>();
		child.stdout!.on('data', chunk => { output += chunk.toString(); if (output.includes('worker-ready')) ready.resolve(); });
		child.stderr!.on('data', chunk => { output += chunk.toString(); });
		child.once('error', error => ready.reject(error));
		exited = new Promise(resolve => child!.once('close', (code, received) => resolve({ code, signal: received })));
		timeout = setTimeout(() => { ready.reject(new Error(output || 'Worker did not become ready.')); child?.kill('SIGKILL'); }, 15_000);
		await Promise.race([ready.promise, exited.then(() => { throw new Error(`Worker exited before readiness: ${output}`); })]);
		child.kill(signal);
		expect(await exited, output).toEqual({ code: 0, signal: null });
		expect(await readFile(join(directory, 'closed'), 'utf8')).toBe('closed');
	} finally {
		clearTimeout(timeout);
		if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
		await exited;
		await rm(directory, { recursive: true, force: true });
	}
}, 20_000);
