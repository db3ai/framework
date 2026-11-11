/** A `db3/billing.json` shaped like db3 Cloud's, used across billing tests. */
export const billingConfigJson = {
	currency: 'usd',
	graceDays: 3,
	newAccountSpendLimit: 5000,
	prices: {
		'server.small': { per: 'month', amount: 672, label: 'db3 Server (1 GB)' },
		'server.medium': { per: 'month', amount: 2400, label: 'db3 Server (4 GB)' },
		'addon.security-monitor': { per: 'day', amount: 10, label: 'Security monitor' },
		'domain.check': { per: 'use', amount: 2, label: 'Domain check' },
	},
	credits: {
		ai: {
			label: 'AI credits',
			packs: { 'ai-10': { amount: 1000, credits: 1000 }, 'ai-50': { amount: 5000, credits: 5200 } },
			autoTopUp: { below: 100, pack: 'ai-10' },
		},
	},
};
