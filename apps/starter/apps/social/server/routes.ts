import type { AppRoute } from '@db3.ai/app/apps';
import type App from '../App.js';

/** Host-authenticated adapters; the Social service owns validation, authorization scope and persistence. */
export const socialRoutes: readonly AppRoute<App>[] = [
	{ method: 'GET', path: '/opportunities',
		/** Lists only the authenticated person's opportunities. */
		handle: async ({ service, actor }) => ({ opportunities: await service.list(actor.id) }),
	},
	{ method: 'POST', path: '/opportunities', status: 201,
		/** Saves a manually discovered discussion without contacting its destination. */
		handle: async ({ service, actor, body }) => ({ opportunity: await service.save(actor.id, body) }),
	},
	{ method: 'PATCH', path: '/opportunities/:id',
		/** Records the caller's progress on their own opportunity. */
		handle: async ({ service, actor, params, body }) => ({ opportunity: await service.update(actor.id, params.id, body) }),
	},
];
