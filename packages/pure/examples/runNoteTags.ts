import { selectNoteTags } from './selectNoteTags';

/** Exercises normalized selection, rejected unknown values and valid recovery. */
export function runNoteTags() {
	let invalidRejected = false;
	try { selectNoteTags(['Administrator']); } catch { invalidRejected = true; }
	return { tags: selectNoteTags([' client ', 'CLIENT', ' internal ']), invalidRejected, repaired: selectNoteTags(['Internal']) };
}

console.log(JSON.stringify(runNoteTags(), null, 2));
