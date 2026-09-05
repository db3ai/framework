import { pathToFileURL } from 'node:url';
import { Cache } from '@db3.ai/app/cache';

/**
 * Runs cache-through reads, owner-key isolation, invalidation and failure recovery.
 *
 * The counted factory represents an expensive lookup without needing a database.
 * It is deterministic and uses the real bounded memory driver.
 *
 * @returns Observable cache outcomes, after closing the owned store.
 */
export async function runNoteCache() {
	const cache = new Cache({ default: 'memory', stores: { memory: { driver: 'memory', ttl: 60_000, maxEntries: 100 } } });
	let loads = 0;
	/** Computes one example summary when the cache has no value. */
	const loadSummary = async () => ({ count: ++loads });
	try {
		const key = 'notes:v1:owner:ada:summary';
		const concurrent = await Promise.all([cache.getOrSet(key, loadSummary), cache.getOrSet(key, loadSummary)]);
		const firstLoads = loads;
		await cache.set('notes:v1:owner:grace:summary', { count: 9 });
		await cache.forget(key);
		const refreshed = await cache.getOrSet(key, loadSummary);
		let rejectedUndefined = false;
		try { await cache.set('invalid', undefined); } catch { rejectedUndefined = true; }
		let rejectedFactory = false;
		try { await cache.getOrSet('recover', () => { throw new Error('Lookup failed'); }); } catch { rejectedFactory = true; }
		const recovered = await cache.getOrSet('recover', () => 'ready');
		const otherOwner = await cache.get('notes:v1:owner:grace:summary');
		await cache.clear();
		return { concurrent, firstLoads, refreshed, otherOwner, rejectedUndefined, rejectedFactory, recovered, cleared: await cache.get(key) === undefined };
	} finally {
		await cache.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runNoteCache(), null, 2));
