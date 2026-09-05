import { expect, it } from 'vitest';
import { selectNoteTags } from '../examples/selectNoteTags';

it('normalizes allowed tags but rejects unknown selections before recovery', () => {
	expect(selectNoteTags([' client ', 'CLIENT', ' internal '])).toEqual(['Client', 'Internal']);
	expect(() => selectNoteTags(['Administrator'])).toThrow('supported note tag');
	expect(selectNoteTags(['Internal'])).toEqual(['Internal']);
	expect(selectNoteTags([])).toEqual([]);
});
