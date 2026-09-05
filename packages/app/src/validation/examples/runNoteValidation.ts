import { pathToFileURL } from 'node:url';
import { validateNoteInput } from './validateNoteInput';

/**
 * Exercises rejected input and recovery without a database or network access.
 *
 * @returns Invalid and repaired request outcomes; no submitted secret is returned.
 */
export function runNoteValidation() {
	return {
		invalid: validateNoteInput({ title: '   ', priority: '9', password: 'do-not-return-this' }),
		repaired: validateNoteInput({ title: ' First note ', priority: '2', ownerId: 'attacker-controlled' }),
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(runNoteValidation(), null, 2));
}
