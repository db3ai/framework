import { app } from '@db3.ai/app/server';
import { QueueableJob } from '@db3.ai/app/queue';
import type App from '../../App.js';

/** Queued hourly review of saved discussions; it does not call any social platform. */
export class ReviewSavedOpportunitiesJob extends QueueableJob {
	static jobName = 'social.review-saved-opportunities';

	/** Creates a serializable job with no request-specific or secret state. */
	constructor() { super({}); }

	/** Delegates to the installed app's public service after worker bootstrap. */
	async handle(): Promise<void> {
		await (app().apps.require('social') as App).reviewSavedOpportunities();
	}
}
