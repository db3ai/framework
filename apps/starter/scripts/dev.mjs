import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pretty = process.env.PLATFORM_LOG_FORMAT === 'pretty' || (!process.env.PLATFORM_LOG_FORMAT || process.env.PLATFORM_LOG_FORMAT === 'auto') && process.stdout.isTTY;
const { DevelopmentConsole } = pretty ? await import('@db3.ai/app/logging') : {};
const output = DevelopmentConsole ? new DevelopmentConsole() : undefined;
const options = { stdio: output ? ['inherit', 'pipe', 'pipe'] : 'inherit', env: output ? { ...process.env, PLATFORM_LOG_FORMAT: 'json' } : process.env };
const children = [
	spawn(npm, ['exec', '--', 'tsx', 'watch', 'server/index.ts'], options),
	spawn(npm, ['exec', '--', 'vite', '--configLoader', 'runner'], options),
];
let stopping = false;
let remaining = children.length;

/** Stops both development processes so a failed port bind cannot leave a stale app. */
function stop(code = 0) {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill('SIGTERM');
	process.exitCode = code;
}

for (const child of children) {
	if (output) { child.stdout.pipe(output.createInput()); child.stderr.pipe(output.createInput()); }
	child.once('close', async () => { if (--remaining === 0) { output?.close(); await output?.flush(); } });
	child.once('error', () => stop(1));
	child.once('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
