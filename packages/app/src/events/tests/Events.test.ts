import type { Knex } from 'knex';
import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { Events } from '../index';
import { App } from '../../server';

/**
 * Application event emitted after a website crawl completes.
 */
class WebsiteCrawled {
	/**
	 * Creates a crawl completion event.
	 *
	 * @param websiteId - Website that completed crawling.
	 */
	constructor(readonly websiteId: string) {}
}

/**
 * Distinct subclass used to verify exact class matching.
 */
class WebsiteRecrawled extends WebsiteCrawled {}

/**
 * Unrelated application event used to verify listener isolation.
 */
class InvoicePaid {
	/**
	 * Creates a payment completion event.
	 *
	 * @param invoiceId - Invoice that was paid.
	 */
	constructor(readonly invoiceId: string) {}
}

describe('Events', () => {
	it('awaits listeners sequentially in registration order', async () => {
		const events = new Events();
		const calls: string[] = [];
		let releaseFirst: () => void = () => {};
		const firstListenerWait = new Promise<void>(resolve => {
			releaseFirst = resolve;
		});

		events.listen(WebsiteCrawled, async event => {
			calls.push(`first:start:${event.websiteId}`);
			await firstListenerWait;
			calls.push('first:end');
		});
		events.listen(WebsiteCrawled, event => {
			calls.push(`second:${event.websiteId}`);
		});

		const dispatched = events.dispatch(new WebsiteCrawled('website-1'));

		expect(calls).toEqual([
			'first:start:website-1',
		]);

		releaseFirst();
		await dispatched;

		expect(calls).toEqual([
			'first:start:website-1',
			'first:end',
			'second:website-1',
		]);
	});

	it('matches exact event classes and removes individual subscriptions', async () => {
		const events = new Events();
		const crawled = vi.fn();
		const secondCrawled = vi.fn();
		const invoicePaid = vi.fn();
		const unsubscribe = events.listen(WebsiteCrawled, crawled);

		events.listen(WebsiteCrawled, secondCrawled);
		events.listen(InvoicePaid, invoicePaid);

		await events.dispatch(new WebsiteRecrawled('website-1'));

		expect(crawled).not.toHaveBeenCalled();
		expect(secondCrawled).not.toHaveBeenCalled();

		await events.dispatch(new WebsiteCrawled('website-2'));
		unsubscribe();
		unsubscribe();
		await events.dispatch(new WebsiteCrawled('website-3'));

		expect(crawled).toHaveBeenCalledOnce();
		expect(secondCrawled).toHaveBeenCalledTimes(2);
		expect(invoicePaid).not.toHaveBeenCalled();
	});

	it('invokes one-shot listeners at most once across overlapping dispatches', async () => {
		const events = new Events();
		const listener = vi.fn(async () => {
			await Promise.resolve();
		});

		events.once(WebsiteCrawled, listener);

		await Promise.all([
			events.dispatch(new WebsiteCrawled('website-1')),
			events.dispatch(new WebsiteCrawled('website-2')),
		]);

		expect(listener).toHaveBeenCalledOnce();
		expect(events.hasListeners(WebsiteCrawled)).toBe(false);
	});

	it('propagates listener failures and does not run later listeners', async () => {
		const events = new Events();
		const laterListener = vi.fn();

		events.listen(WebsiteCrawled, () => {
			throw new Error('Listener failed.');
		});
		events.listen(WebsiteCrawled, laterListener);

		await expect(
			events.dispatch(new WebsiteCrawled('website-1')),
		).rejects.toThrow('Listener failed.');
		expect(laterListener).not.toHaveBeenCalled();
	});

	it('forgets event listeners and rejects ambiguous plain objects', async () => {
		const events = new Events();

		events.listen(WebsiteCrawled, () => {});
		expect(events.hasListeners(WebsiteCrawled)).toBe(true);

		events.forget(WebsiteCrawled);
		expect(events.hasListeners(WebsiteCrawled)).toBe(false);

		await expect(
			events.dispatch({
				type: 'website.crawled',
			}),
		).rejects.toThrow('Events must be class instances');
	});

	it('exposes one cached dispatcher and clears it during app shutdown', async () => {
		const application = new App({
			db: {} as Knex,
		});
		const events = application.events;

		events.listen(WebsiteCrawled, () => {});

		expect(application.events).toBe(events);
		expect(events.hasListeners(WebsiteCrawled)).toBe(true);

		await application.close();

		expect(events.hasListeners(WebsiteCrawled)).toBe(false);
	});
});
