/**
 * How much a call to a route can change, from least to most. Documentation shows it on every route,
 * and `appTools` offers AI agents only the risks a host allows, `read` by default.
 *
 * - `read`: reads the app's own state, such as what exists and its status.
 * - `private`: reads people's data or secrets, such as records, messages or key values.
 * - `change`: changes something that can be changed back.
 * - `risky`: costs money, interrupts a service, opens access or changes an address.
 * - `destructive`: deletes or overwrites what can't be brought back.
 */
export type AppRouteRisk = 'read' | 'private' | 'change' | 'risky' | 'destructive';

/** Every risk, from least to most, with what it means for documentation. */
export const APP_ROUTE_RISKS: Readonly<Record<AppRouteRisk, string>> = {
	read: 'Reads the app\'s own state, such as what exists and its status.',
	private: 'Reads people\'s data or secrets, such as records, messages or key values.',
	change: 'Changes something that can be changed back.',
	risky: 'Costs money, interrupts a service, opens access or changes an address.',
	destructive: 'Deletes or overwrites what can\'t be brought back.',
};
