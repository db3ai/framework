import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serviceName = process.argv[2];
const extraArguments = process.argv.slice(3);

if (!serviceName) {
	throw new Error(
		'Provide a service name, for example: npm run test:service --workspace packages/app -- auth',
	);
}

if (!/^[a-z][a-z0-9-]*$/.test(serviceName)) {
	throw new Error(`Invalid framework service name "${serviceName}".`);
}

const serviceTestDirectory = new URL(`../src/${serviceName}/tests/`, import.meta.url);

if (!existsSync(serviceTestDirectory)) {
	throw new Error(
		`Framework service "${serviceName}" has no service-owned tests at src/${serviceName}/tests.`,
	);
}

const vitestPath = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));
const testPath = `src/${serviceName}/tests`;
const result = spawnSync(
	process.execPath,
	[
		vitestPath,
		'run',
		testPath,
		...extraArguments,
	],
	{
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		env: process.env,
		stdio: 'inherit',
	},
);

if (result.error) {
	throw result.error;
}

process.exitCode = result.status ?? 1;
