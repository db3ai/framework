import { inject, onScopeDispose, provide, ref, type InjectionKey, type Ref } from 'vue';

import type { DockStore } from './useDock.js';
import type { LayoutState } from './useLayout.js';

/** What the Dock root shares with its components. */
export interface DockContext {
	dock: DockStore;
	layout: LayoutState;
	/** Current time, refreshed every few seconds for uptime labels. */
	now: Ref<number>;
	/** Opens the Add process dialog for a project. */
	openAddProcess(projectId: string): void;
}

const KEY: InjectionKey<DockContext> = Symbol('dock');

/**
 * Provides the Dock context from the root component and starts the clock.
 *
 * @param context - Store, layout and dialog opener.
 * @returns The provided context.
 */
export function provideDockContext(context: Omit<DockContext, 'now'>): DockContext {
	const now = ref(Date.now());
	const timer = setInterval(() => {
		now.value = Date.now();
	}, 5000);
	onScopeDispose(() => clearInterval(timer));
	const value = { ...context, now };
	provide(KEY, value);
	return value;
}

/** @returns The context provided by the Dock root. */
export function useDockContext(): DockContext {
	const context = inject(KEY);
	if (!context) throw new Error('useDockContext() needs provideDockContext() in an ancestor.');
	return context;
}
