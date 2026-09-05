import { expect, it } from 'vitest';
import { Events } from '@db3.ai/app/events';
import { NoteSaved } from '../../examples/NoteSaved';
import { runNoteEvents } from '../../examples/runNoteEvents';

it('awaits ordered listeners, invokes once once, propagates failure and recovers after removal', async () => {
	expect(await runNoteEvents()).toEqual({ trace: ['index:one', 'first:one', 'index:two', 'after:four'], rejected: true, hasListeners: false });
});

it('dispatches exact classes only and rejects anonymous payloads', async () => {
	const events = new Events();
	/** Distinct event identity, not an implicit subscription to the base event. */
	class ImportedNoteSaved extends NoteSaved {}
	let calls = 0;
	const stop = events.listen(NoteSaved, () => { calls++; });
	try {
		await events.dispatch(new ImportedNoteSaved('one', 'ada'));
		expect(calls).toBe(0);
		await expect(events.dispatch({ noteId: 'one' })).rejects.toThrow('class instances');
		await events.dispatch(new NoteSaved('one', 'ada'));
		expect(calls).toBe(1);
		stop();
		stop();
		expect(events.hasListeners(NoteSaved)).toBe(false);
	} finally { events.clear(); }
});
