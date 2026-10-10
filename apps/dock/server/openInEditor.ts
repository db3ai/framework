import { spawn } from 'node:child_process';

/**
 * Opens a folder in the configured editor without waiting for it.
 *
 * @param folder - Absolute folder path.
 * @param editor - Command to run, such as `cursor` or `code`.
 * @returns Resolves once the editor command has been launched.
 * @throws When the command cannot be started.
 */
export function openInEditor(folder: string, editor: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(editor, [folder], { detached: true, stdio: 'ignore' });
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}
