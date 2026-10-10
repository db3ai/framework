import { chmod, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Makes node-pty's `spawn-helper` executable.
 *
 * node-pty 1.x ships prebuilt binaries whose macOS `spawn-helper` can be
 * installed without its execute bit; every spawn then fails with
 * `posix_spawnp failed`. Fixing the mode at startup avoids a postinstall step.
 *
 * @returns Resolves once the helper is executable, or when there is none to fix.
 */
export async function ensurePtyHelper(): Promise<void> {
	if (process.platform === 'win32') return;
	let root: string;
	try {
		root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
	} catch {
		return;
	}
	for (const folder of [join('prebuilds', `${process.platform}-${process.arch}`), join('build', 'Release')]) {
		const helper = join(root, folder, 'spawn-helper');
		try {
			const { mode } = await stat(helper);
			if ((mode & 0o111) !== 0o111) await chmod(helper, mode | 0o755);
		} catch {
			// Not present in this layout.
		}
	}
}
