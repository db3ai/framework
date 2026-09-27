import type * as apps from './contracts';

/** Validates a contribution and copies only supported, browser-safe fields into the response. */
export function normalizeAppNavigation(value: apps.AppNavigation): apps.AppNavigation {
	if (!value || !Array.isArray(value.items)) throw new Error('Navigation must provide an items array.');
	const ids = new Set<string>();
	return {
		...details(value),
		items: value.items.map(item => {
			if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() || typeof item.path !== 'string' || !/^(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(item.path)) throw new Error('Invalid or duplicate navigation item.');
			ids.add(item.id);
			return { id: item.id, label: item.label, path: item.path, ...details(item) };
		}),
	};
}

/** Copies optional display information without passing through arbitrary provider data. */
function details(value: { description?: string; badge?: apps.AppNavigationBadge }): Pick<apps.AppNavigation, 'description' | 'badge'> {
	const result: Pick<apps.AppNavigation, 'description' | 'badge'> = {};
	if (value.description !== undefined) {
		if (typeof value.description !== 'string') throw new Error('Navigation descriptions must be plain text.');
		result.description = value.description;
	}
	if (value.badge !== undefined) {
		if (!value.badge || !Number.isSafeInteger(value.badge.count) || value.badge.count < 0 || typeof value.badge.label !== 'string' || !value.badge.label.trim()) throw new Error('Navigation badges require a non-negative integer count and an accessible label.');
		result.badge = { count: value.badge.count, label: value.badge.label };
	}
	return result;
}
