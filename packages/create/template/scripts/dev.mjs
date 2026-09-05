import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
	spawn(npm, ['exec', '--', 'tsx', 'watch', 'server/index.ts'], { stdio: 'inherit' }),
	spawn(npm, ['exec', '--', 'vite'], { stdio: 'inherit' }),
];
let stopping = false;

/** Stops both development processes so a failed port bind cannot leave a stale app. */
function stop(code = 0) {
	if (stopping) return;
	stopping = true;
	for (const child of children) child.kill('SIGTERM');
	process.exitCode = code;
}

for (const child of children) {
	child.once('error', () => stop(1));
	child.once('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
