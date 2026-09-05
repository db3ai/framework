import { pathToFileURL } from 'node:url';
import { Events } from '@db3.ai/app/events';
import { NoteSaved } from './NoteSaved';

/**
 * Exercises ordered listeners, one-shot observation, failure and explicit repair.
 * @returns The dispatch trace and teardown state; no durable side effect is made.
 */
export async function runNoteEvents() {
	const events = new Events();
	const trace: string[] = [];
	try {
		const unsubscribe = events.listen(NoteSaved, async event => { await Promise.resolve(); trace.push(`index:${event.noteId}`); });
		events.once(NoteSaved, event => { trace.push(`first:${event.noteId}`); });
		await events.dispatch(new NoteSaved('one', 'ada'));
		await events.dispatch(new NoteSaved('two', 'ada'));
		unsubscribe();
		const removeFailure = events.listen(NoteSaved, () => { throw new Error('Reaction failed'); });
		events.listen(NoteSaved, event => { trace.push(`after:${event.noteId}`); });
		let rejected = false;
		try { await events.dispatch(new NoteSaved('three', 'ada')); } catch { rejected = true; }
		removeFailure();
		await events.dispatch(new NoteSaved('four', 'ada'));
		events.forget(NoteSaved);
		return { trace, rejected, hasListeners: events.hasListeners(NoteSaved) };
	} finally {
		events.clear();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runNoteEvents(), null, 2));
