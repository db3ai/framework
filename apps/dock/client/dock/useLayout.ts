import { reactive, watch } from 'vue';

/** Window layout choices remembered between sessions. */
/** Colour theme preference; `system` follows the operating system. */
export type ThemePreference = 'system' | 'light' | 'dark';

export interface LayoutState {
	theme: ThemePreference;
	view: 'list' | 'terminals';
	sidebarCollapsed: boolean;
	/** Selected project id, or `all`. */
	project: string;
	/** Process shown in the list view's output panel. */
	selectedProcess: string | null;
	/** Process expanded to fill the terminals grid. */
	maximized: string | null;
	/** Height in pixels of the list view's output panel. */
	panelHeight: number;
	/** Relative column widths in the terminals view, by process id. */
	columnWidths: Record<string, number>;
	/** Row heights in pixels in the terminals view when several projects show, by project id. */
	projectHeights: Record<string, number>;
}

const KEY = 'db3-dock.layout';
const DEFAULTS: LayoutState = {
	theme: 'system',
	view: 'list',
	sidebarCollapsed: false,
	project: 'all',
	selectedProcess: null,
	maximized: null,
	panelHeight: 280,
	columnWidths: {},
	projectHeights: {},
};

/**
 * Layout state persisted to localStorage (when available).
 *
 * @param storage - Storage to use; tests pass a stub.
 * @returns Reactive layout state.
 */
export function useLayout(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): LayoutState {
	let saved: Partial<LayoutState> = {};
	try {
		saved = JSON.parse(storage?.getItem(KEY) ?? '{}') as Partial<LayoutState>;
	} catch {
		saved = {};
	}
	const layout = reactive<LayoutState>({ ...DEFAULTS, ...saved, maximized: null });
	watch(layout, value => {
		try {
			storage?.setItem(KEY, JSON.stringify(value));
		} catch {
			// Storage full or blocked: layout simply isn't remembered.
		}
	}, { deep: true });
	return layout;
}

function safeStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
