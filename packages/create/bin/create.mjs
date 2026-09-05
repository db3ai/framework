#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { createProject } from '../src/createProject.mjs';
import { assertLocalDockerHost } from '../src/assertLocalDockerHost.mjs';

/** Runs a child command in the generated app and fails without deleting user work. */
async function run(command, args, cwd) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} stopped (${signal ?? code}). Your project is still at ${cwd}.`)));
	});
}

/** Generates, installs and starts the chosen starter with explicit database setup. */
async function main() {
	const args = process.argv.slice(2);
	if (args.includes('--help')) {
		console.log('Usage: npm create @db3.ai@latest my-app [-- --docker | --no-install | --no-start]\nDefault: use your local MariaDB database. --docker starts only MariaDB in Docker.\nEach app developer adds their own OPENAI_API_KEY to .env; AI is optional.');
		return;
	}
	const allowed = new Set(['--docker', '--no-install', '--no-start']);
	if (args.some(value => value.startsWith('-') && !allowed.has(value))) throw new Error('Unknown option. Run with --help.');
	const names = args.filter(value => !value.startsWith('-'));
	if (names.length !== 1) throw new Error('Supply one project name, for example: npm create @db3.ai@latest my-app');
	const target = await createProject(names[0], { docker: args.includes('--docker') });
	console.log(`Created ${target}. No AI key has been copied or generated.`);
	if (args.includes('--no-install')) {
		console.log(`Next: open ${target}/README.md. Configure .env, then run npm install, npm run db:migrate and npm run dev from that directory.`);
		return;
	}
	if (args.includes('--docker')) {
		const endpoint = (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) || spawnSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).stdout?.trim() || '';
		assertLocalDockerHost(endpoint);
		if (spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0) {
			await run('docker', ['compose', 'up', '-d', '--wait', 'db'], target);
		} else if (spawnSync('docker-compose', ['version'], { stdio: 'ignore' }).status === 0) {
			await run('docker-compose', ['up', '-d', '--wait', 'db'], target);
		} else {
			throw new Error('Docker Compose is not installed. Install Docker with Compose, or use local MariaDB. Your generated files have been kept.');
		}
	} else {
		console.log(`Create a MariaDB database and user using ${target}/README.md, then update ${target}/.env.`);
		if (!process.stdin.isTTY) throw new Error('Local setup requires an interactive terminal. Use --no-install to generate files for scripted setup.');
		const prompt = createInterface({ input: process.stdin, output: process.stdout });
		try { await prompt.question('Press Enter when your database configuration is ready. '); } finally { prompt.close(); }
	}
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	await run(npm, ['install'], target);
	await run(npm, ['run', 'db:migrate'], target);
	if (!args.includes('--no-start')) await run(npm, ['run', 'dev'], target);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
