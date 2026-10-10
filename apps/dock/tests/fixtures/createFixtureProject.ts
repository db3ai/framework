import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A disposable project folder with npm scripts that behave like db3 processes. */
export interface FixtureProject {
	root: string;
	path: string;
	configFile: string;
	dispose(): Promise<void>;
}

/**
 * Creates a temporary project:
 * - `dev` announces a localhost port, echoes stdin and runs until stopped;
 * - `queue` prints its arguments and exits with code 1;
 * - `scheduler` already includes `scheduler:work` in its body;
 * - `server/jobs.ts` declares queues and a worker pool for the source scan.
 *
 * @returns Paths and a cleanup function.
 */
export async function createFixtureProject(): Promise<FixtureProject> {
	const root = await mkdtemp(join(tmpdir(), 'db3-dock-'));
	const path = join(root, 'demo-app');
	await mkdir(join(path, 'server'), { recursive: true });
	await writeFile(join(path, 'package.json'), JSON.stringify({
		name: 'demo-app',
		private: true,
		scripts: {
			dev: 'node dev.mjs',
			queue: 'node queue.mjs',
			scheduler: 'node scheduler.mjs scheduler:work',
			'db:migrate': 'node -e 0',
		},
	}, null, '\t'));
	await writeFile(join(path, 'dev.mjs'), [
		`console.log('\\u001b[32mready\\u001b[39m Local: http://localhost:45173/');`,
		`console.log('tty:' + Boolean(process.stdout.isTTY) + ' cols:' + process.stdout.columns);`,
		`process.stdout.on('resize', () => console.log('resize:' + process.stdout.columns + 'x' + process.stdout.rows));`,
		`process.stdin.setEncoding('utf8').on('data', text => console.log('echo:' + text.trim()));`,
		`setInterval(() => {}, 1000);`,
	].join('\n'));
	await writeFile(join(path, 'queue.mjs'), `console.log('args:' + process.argv.slice(2).join(' ')); console.error('boom'); process.exit(1);`);
	await writeFile(join(path, 'scheduler.mjs'), `setInterval(() => {}, 1000);`);
	await writeFile(join(path, 'server', 'jobs.ts'), [
		`export const emails = { queue: 'emails' };`,
		`await app.queue.dispatch(job, { queue: "reports" });`,
		`runQueueConsole({ app, workers: { general: { queues: '*', excludeQueues: ['article-images'] }, content: { queues: ['articles'] } } });`,
	].join('\n'));
	return {
		root,
		path,
		configFile: join(root, 'config', 'projects.json'),
		dispose: () => rm(root, { recursive: true, force: true }),
	};
}
