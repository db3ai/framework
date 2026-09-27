import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, relative } from 'node:path';

/**
 * Runs every verification stage even after failures, preserving test arguments
 * as separate process arguments and streaming diagnostics as they arrive.
 * @param {{label: string, command: string, args: string[], cwd: string}[]} stages - Ordered verification commands.
 * @returns {Promise<{label: string, passed: boolean}[]>} Outcomes used by the final exit status.
 */
export async function runVerification(stages) {
	const results = [];
	for (const stage of stages) {
		console.log(`\n── ${stage.label} ──`);
		const passed = await new Promise(resolveResult => {
			const env = { ...process.env };
			// Child tools are independent processes, not Node test-runner workers.
			delete env.NODE_TEST_CONTEXT;
			const child = spawn(stage.command, stage.args, { cwd: stage.cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
			child.stdout.on('data', chunk => process.stdout.write(chunk));
			child.stderr.on('data', chunk => process.stderr.write(chunk));
			child.once('error', error => { console.error(error.message); resolveResult(false); });
			child.once('close', (code, signal) => resolveResult(code === 0 && !signal));
		});
		results.push({ label: stage.label, passed });
	}
	console.log('\nVerification summary');
	for (const result of results) console.log(`${result.label}: ${result.passed ? 'passed' : 'FAILED'}`);
	return results;
}

/**
 * Builds the shared test/quality workflow for the invoking workspace. The raw
 * test script is an implementation detail; watch mode remains independent.
 * @returns {Promise<void>} Completes after all checks and sets the process status.
 */
async function main() {
	const [mode, ...testArguments] = process.argv.slice(2);
	if (!['test', 'quality'].includes(mode) || (mode === 'quality' && testArguments.length)) throw new Error('Usage: verify.mjs test [test arguments] | quality');
	const cwd = process.cwd();
	const root = fileURLToPath(new URL('../', import.meta.url));
	const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const stages = [];
	if (mode === 'test') {
		if (!manifest.scripts?.['test:raw']) throw new Error('Missing required test:raw script');
		stages.push({ label: 'Tests', command: npm, args: ['run', 'test:raw', '--', ...testArguments], cwd });
		if (cwd === root.replace(/[\\/]$/, '') && manifest.scripts?.['quality:test']) {
			stages.push({ label: 'Quality-tool tests', command: npm, args: ['run', 'quality:test'], cwd });
		}
	}
	if (!manifest.scripts?.['quality:types']) throw new Error('Missing required quality:types script');
	stages.push({ label: 'Types', command: npm, args: ['run', 'quality:types'], cwd });
	const naming = resolve(root, 'tools/code-quality/checkNaming.mjs');
	if (existsSync(naming)) {
		const scope = relative(root, cwd).split('\\').join('/');
		stages.push({ label: 'Conventions', command: process.execPath, args: [naming, ...(scope ? ['--scope', scope] : [])], cwd: root });
	} else {
		console.log('Conventions: unavailable in this source distribution (Platform-only checker).');
	}
	const results = await runVerification(stages);
	const baseline = resolve(root, 'tools/code-quality/naming-baseline.json');
	if (existsSync(baseline)) console.log(`Convention findings: ${baseline}`);
	console.log(`Result: ${results.every(result => result.passed) ? 'passed' : 'FAILED'}`);
	process.exitCode = results.every(result => result.passed) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
