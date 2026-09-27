import { z } from 'zod';
import { AppService, AppRouteError, type AppNavigation, type AppNavigationContext } from '@db3.ai/app/apps';
import { SocialOpportunity } from './server/models/SocialOpportunity.js';

import { socialRoutes } from './server/routes.js';
import type { Schedule } from '@db3.ai/app/scheduler';
import { schedule } from './server/schedule.js';
import { ReviewSavedOpportunitiesJob } from './server/jobs/ReviewSavedOpportunitiesJob.js';
import { SavedOpportunityNotification } from './server/notifications/SavedOpportunityNotification.js';

const input = z.object({
	title: z.string().trim().min(1).max(200),
	url: z.string().url().max(2048).refine(value => {
		const url = new URL(value);
		return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
	}, 'Use an HTTP or HTTPS discussion link without credentials.'),
	notes: z.string().trim().max(4000).default(''),
}).strict();
const transition = z.object({ status: z.enum(['saved', 'answered', 'dismissed']) }).strict();

/** Public app service. It stores user-selected links and never calls social platforms or posts replies. */
export default class App extends AppService {
	static override models = [SocialOpportunity];
	static override routes = socialRoutes;
	static override jobs = [ReviewSavedOpportunitiesJob];

	/** Keeps schedule declarations together in server/schedule.ts. */
	override schedule(builder: Schedule): void { schedule(builder); }

	/** Reviews saved discussions in bounded pages and sends retry-safe reminders through the host inbox. */
	async reviewSavedOpportunities(): Promise<void> {
		let after = '';
		while (true) {
			const query = SocialOpportunity.where('status', 'saved').orderBy('id').limit(100);
			if (after) query.where('id', '>', after);
			const entries = await query.all();
			for (const entry of entries) {
				if (!entry.owner || !entry.id || !entry.title) throw new Error('Stored social opportunity is missing its owner, identity or title.');
				await this.host.notifications.send(entry.owner, new SavedOpportunityNotification(entry.id, entry.title));
			}
			if (entries.length < 100) return;
			after = entries[entries.length - 1].id!;
		}
	}

	/** Builds current links and a saved-discussion count using only the host-verified viewer's records. */
	override async navigation(context: AppNavigationContext): Promise<AppNavigation> {
		this.#assertOwner(context.actor.id);
		const count = await SocialOpportunity.where({ owner: context.actor.id, status: 'saved' }).count();
		const badge = { count, label: `${count} saved ${count === 1 ? 'opportunity' : 'opportunities'}` };
		return {
			badge,
			description: count ? 'Ready to review' : 'All caught up',
			items: [
				{ id: 'opportunities', label: 'Opportunities', path: '', badge },
				{ id: 'about', label: 'About Social', path: 'about' },
			],
		};
	}

	/** Returns the caller's saved discussions using model serialization. */
	async list(ownerId: string) {
		this.#assertOwner(ownerId);
		return (await SocialOpportunity.where('owner', ownerId).orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(100).all()).map(item => item.toJSON());
	}

	/** Validates and saves a discussion using server-assigned ownership. */
	async save(ownerId: string, value: unknown) {
		this.#assertOwner(ownerId);
		const parsed = input.safeParse(value);
		if (!parsed.success) throw new AppRouteError(400, 'Provide a title, a valid discussion link and notes up to 4,000 characters.');
		const opportunity = SocialOpportunity.create({ ...parsed.data, owner: ownerId, status: 'saved' });
		await opportunity.save();
		return opportunity.toJSON();
	}

	/** Changes progress only for an opportunity owned by the verified caller. */
	async update(ownerId: string, id: string, value: unknown) {
		this.#assertOwner(ownerId);
		const parsed = transition.safeParse(value);
		if (!parsed.success) throw new AppRouteError(400, 'Choose saved, answered or dismissed.');
		const opportunity = await SocialOpportunity.where({ id, owner: ownerId }).first();
		if (!opportunity) throw new AppRouteError(404, 'Opportunity not found.');
		opportunity.status = parsed.data.status;
		await opportunity.save();
		return opportunity.toJSON();
	}

	/** Rejects accidental anonymous calls outside HTTP; callers supply an already authenticated identity. */
	#assertOwner(ownerId: string): void {
		if (!ownerId) throw new AppRouteError(401, 'Please sign in.');
	}
}
